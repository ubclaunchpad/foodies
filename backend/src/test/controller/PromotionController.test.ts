import { getCustomRepository } from 'typeorm';
import { User } from '../../main/entity/User';
import { UserRepository } from '../../main/repository/UserRepository';
import connection from '../repository/BaseRepositoryTest';
import { Express } from 'express';
import request from 'supertest';
import { UserFactory } from '../factory/UserFactory';
import { registerTestApplication } from './BaseController';
import { PromotionFactory } from '../factory/PromotionFactory';
import { DiscountFactory } from '../factory/DiscountFactory';
import { ScheduleFactory } from '../factory/ScheduleFactory';
import { PromotionRepository } from '../../main/repository/PromotionRepository';
import { DiscountType } from '../../main/data/DiscountType';
import { Promotion } from '../../main/entity/Promotion';

describe('Unit tests for PromotionController', function () {
  let userRepository: UserRepository;
  let promotionRepository: PromotionRepository;
  let app: Express;

  beforeAll(async () => {
    await connection.create();
    app = registerTestApplication();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await connection.clear();
    userRepository = getCustomRepository(UserRepository);
    promotionRepository = getCustomRepository(PromotionRepository);
  });

  test('GET /promotions', async (done) => {
    const user: User = new UserFactory().generate();
    const discount = new DiscountFactory().generate();
    const schedule = new ScheduleFactory().generate();
    const promotion = new PromotionFactory().generate(user, discount, [
      schedule,
    ]);

    await userRepository.save(user);
    await promotionRepository.save(promotion);

    request(app)
      .get('/promotions')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const promotions = res.body;
        expect(promotions).toHaveLength(1);
        comparePromotions(promotions[0], promotion);
        done();
      });
  });

  test('GET /promotions - query parameters without search query', async (done) => {
    const user: User = new UserFactory().generate();

    const promotion1 = new PromotionFactory().generate(
      user,
      new DiscountFactory().generate(DiscountType.PERCENTAGE),
      [new ScheduleFactory().generate()]
    );
    const promotion2 = new PromotionFactory().generate(
      user,
      new DiscountFactory().generate(DiscountType.AMOUNT),
      [new ScheduleFactory().generate()]
    );
    const promotion3 = new PromotionFactory().generate(
      user,
      new DiscountFactory().generate(DiscountType.OTHER),
      [new ScheduleFactory().generate()]
    );

    await userRepository.save(user);
    await promotionRepository.save(promotion1);
    await promotionRepository.save(promotion2);
    await promotionRepository.save(promotion3);

    request(app)
      .get('/promotions')
      .query({
        discountType: DiscountType.PERCENTAGE,
      })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const promotions = res.body;
        expect(promotions).toHaveLength(1);
        comparePromotions(promotions[0], promotion1);
        done();
      });
  });

  test('GET /promotions - query parameters with search query', async (done) => {
    const searchKey = 'buffalo wings '; // purposefully have space after
    const user: User = new UserFactory().generate();

    const promotion1 = new PromotionFactory().generate(
      user,
      new DiscountFactory().generate(DiscountType.PERCENTAGE),
      [new ScheduleFactory().generate()]
    );
    const promotion2 = new PromotionFactory().generate(
      user,
      new DiscountFactory().generate(DiscountType.AMOUNT),
      [new ScheduleFactory().generate()]
    );
    const promotion3 = new PromotionFactory().generate(
      user,
      new DiscountFactory().generate(DiscountType.OTHER),
      [new ScheduleFactory().generate()]
    );

    // guarantee that search results will be hit
    promotion1.name = searchKey;
    promotion2.description = searchKey.repeat(3);
    promotion2.name = searchKey.repeat(3);

    await userRepository.save(user);
    await promotionRepository.save(promotion1);
    await promotionRepository.save(promotion2);
    await promotionRepository.save(promotion3);

    request(app)
      .get('/promotions')
      .query({
        searchQuery: searchKey,
      })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const promotions = res.body;
        expect(promotions).toHaveLength(2);

        for (const promotion of promotions) {
          expect(promotion).toHaveProperty('rank');
          expect(promotion).toHaveProperty('boldDescription');
          expect(promotion).toHaveProperty('boldName');
        }
        done();
      });
  });

  test('GET /promotions/:id', async (done) => {
    const user: User = new UserFactory().generate();
    const discount = new DiscountFactory().generate();
    const schedule = new ScheduleFactory().generate();
    const expectedPromotion = new PromotionFactory().generate(user, discount, [
      schedule,
    ]);

    await userRepository.save(user);
    await promotionRepository.save(expectedPromotion);

    request(app)
      .get(`/promotions/${expectedPromotion.id}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const promotion = res.body;
        comparePromotions(promotion, expectedPromotion);
        done();
      });
  });

  test('POST /promotions', async (done) => {
    const user: User = new UserFactory().generate();
    const expectedPromotion = new PromotionFactory().generate(
      user,
      new DiscountFactory().generate(DiscountType.PERCENTAGE),
      [new ScheduleFactory().generate()]
    );

    await userRepository.save(user);
    request(app)
      .post('/promotions')
      .send({ ...expectedPromotion, user: undefined, userId: user.id })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);
        const promotion = res.body;
        comparePromotions(promotion, expectedPromotion);
        done();
      });
  });

  test('POST /promotions/ - invalid request body should be caught', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generate(
      user,
      new DiscountFactory().generate(DiscountType.PERCENTAGE),
      [new ScheduleFactory().generate()]
    );

    await userRepository.save(user);
    request(app)
      .post('/promotions')
      .send({
        ...promotion,
        user: undefined,
        userId: user.id,
        cuisine: 'nonexistentcuisinetype',
      })
      .expect(400)
      .end((err, res) => {
        const frontEndErrorObject = res.body;
        expect(frontEndErrorObject?.errorCode).toEqual('ValidationError');
        expect(frontEndErrorObject.message).toHaveLength(1);
        expect(frontEndErrorObject.message[0]).toContain(
          '"cuisine" must be one of'
        );
        done();
      });
  });

  test('DELETE /promotions/:id', async () => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generate(
      user,
      new DiscountFactory().generate(DiscountType.PERCENTAGE),
      [new ScheduleFactory().generate()]
    );

    await userRepository.save(user);
    await promotionRepository.save(promotion);
    await request(app).delete(`/promotions/${promotion.id}`).expect(204);

    // check that user no longer exists
    await expect(
      promotionRepository.findOneOrFail({ id: promotion.id })
    ).rejects.toThrowError();
  });

  /**
   * Compare actual promotion against expected promotion
   * */
  function comparePromotions(
    actualPromotion: Promotion,
    expectedPromotion: Promotion
  ) {
    const promotionObject: any = {
      name: expectedPromotion.name,
      description: expectedPromotion.description,
      placeId: expectedPromotion.placeId,
      expirationDate: expectedPromotion.expirationDate.toISOString(),
      startDate: expectedPromotion.startDate.toISOString(),
    };

    // since id is undefined in POST requests
    if (!expectedPromotion.id) {
      delete promotionObject.id;
    }

    if (expectedPromotion.dateAdded) {
      promotionObject.dateAdded = expectedPromotion.dateAdded.toISOString();
    }
    expect(actualPromotion).toMatchObject(promotionObject);

    if (expectedPromotion.discount) {
      const discountObject: any = { ...expectedPromotion.discount };

      if (!expectedPromotion.discount.id) {
        delete discountObject.id;
      }
      expect(actualPromotion.discount).toMatchObject(discountObject);
    }

    if (expectedPromotion.schedules && expectedPromotion.schedules.length > 0) {
      const result = [];
      for (const schedule of expectedPromotion.schedules) {
        const scheduleObject: any = { ...schedule };

        // if POST request, id undefined and modify start/end times to format that postgres stores
        if (!schedule.id) {
          delete scheduleObject.id;
          scheduleObject.endTime = schedule.endTime + ':00';
          scheduleObject.startTime = schedule.startTime + ':00';
        }
        result.push(scheduleObject);
      }
      expect(actualPromotion.schedules).toMatchObject(result);
    }
  }
});
