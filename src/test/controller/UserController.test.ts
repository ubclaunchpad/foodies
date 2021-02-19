import { getManager, getCustomRepository, EntityManager } from 'typeorm';
import { User } from '../../main/entity/User';
import { UserRepository } from '../../main/repository/UserRepository';
import connection from '../repository/BaseRepositoryTest';
import { Express } from 'express';
import request from 'supertest';
import { UserFactory } from '../factory/UserFactory';
import { connectRedisClient, registerTestApplication } from './BaseController';
import { PromotionFactory } from '../factory/PromotionFactory';
import { DiscountFactory } from '../factory/DiscountFactory';
import { ScheduleFactory } from '../factory/ScheduleFactory';
import { PromotionRepository } from '../../main/repository/PromotionRepository';
import { RedisClient } from 'redis-mock';
import { SavedPromotion } from '../../main/entity/SavedPromotion';

describe('Unit tests for UserController', function () {
  let userRepository: UserRepository;
  let promotionRepository: PromotionRepository;
  let app: Express;
  let redisClient: RedisClient;

  beforeAll(async () => {
    await connection.create();
    redisClient = await connectRedisClient();
    app = await registerTestApplication(redisClient);
  });

  afterAll(async () => {
    await connection.close();
    redisClient.quit();
  });

  beforeEach(async () => {
    await connection.clear();
    userRepository = getCustomRepository(UserRepository);
    promotionRepository = getCustomRepository(PromotionRepository);
  });

  test('GET /users', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    await userRepository.save(expectedUser);
    request(app)
      .get('/users')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const users = res.body;
        expect(users).toHaveLength(1);
        compareUsers(users[0], expectedUser);
        done();
      });
  });

  test('GET /users/:id', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    await userRepository.save(expectedUser);
    request(app)
      .get(`/users/${expectedUser.id}`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const user = res.body;
        compareUsers(user, expectedUser);
        done();
      });
  });

  test('POST /users', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    request(app)
      .post('/users')
      .send(expectedUser)
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);
        const user = res.body;
        compareUsers(user, expectedUser);
        done();
      });
  });

  test('POST /users/ - invalid request body should be caught', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    request(app)
      .post('/users')
      .send({
        ...expectedUser,
        id: undefined, // POST request to users should not contain id
        email: 'invalid email',
      })
      .expect(400)
      .end((err, res) => {
        const frontEndErrorObject = res.body;
        expect(frontEndErrorObject?.errorCode).toEqual('ValidationError');
        expect(frontEndErrorObject.message).toHaveLength(1);
        expect(frontEndErrorObject.message[0]).toEqual(
          '"email" must be a valid email'
        );
        done();
      });
  });

  test('PATCH /users/:id', async (done) => {
    const changedProperties = {
      firstName: 'Diff firstName',
      lastName: 'Diff lastName',
      email: 'Diffemail@gmail.com',
    };
    const expectedUser: User = new UserFactory().generate();
    await userRepository.save(expectedUser);
    request(app)
      .patch(`/users/${expectedUser.id}`)
      .send({
        ...changedProperties,
      })
      .expect(204)
      .then(() => {
        // check properties of user have changed
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            const userRepository = transactionalEntityManager.getCustomRepository(
              UserRepository
            );
            const user = await userRepository.findOneOrFail({
              id: expectedUser.id,
            });
            expect(user).toMatchObject(changedProperties);
            done();
          }
        );
      });
  });

  test('PATCH /users/:id - invalid request body should be caught', async (done) => {
    const changedProperties = {
      email: 'Invalid email',
    };
    const expectedUser: User = new UserFactory().generate();
    await userRepository.save(expectedUser);
    request(app)
      .patch(`/users/${expectedUser.id}`)
      .send({
        ...changedProperties,
      })
      .expect(400)
      .end((err, res) => {
        const frontEndErrorObject = res.body;
        expect(frontEndErrorObject?.errorCode).toEqual('ValidationError');
        expect(frontEndErrorObject.message).toHaveLength(1);
        expect(frontEndErrorObject.message[0]).toEqual(
          '"email" must be a valid email'
        );
        done();
      });
  });

  test('DELETE /users/:id', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    await userRepository.save(expectedUser);
    request(app)
      .delete(`/users/${expectedUser.id}`)
      .expect(204)
      .then(() => {
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            // check that user no longer exists
            const userRepository = transactionalEntityManager.getCustomRepository(
              UserRepository
            );
            await expect(
              userRepository.findOneOrFail({ id: expectedUser.id })
            ).rejects.toThrowError();
            done();
          }
        );
      });
  });

  test('DELETE /users/:id - delete non-existent user should not fail', async (done) => {
    const nonExistentUUID = '65d7bc0a-6490-4e09-82e0-cb835a64e1b8';
    request(app)
      .delete(`/users/${nonExistentUUID}`)
      .expect(204)
      .end(async () => {
        // check that user no longer exists
        await expect(
          userRepository.findOneOrFail({ id: nonExistentUUID })
        ).rejects.toThrowError();
        done();
      });
  });

  test('GET /users/:id/savedPromotions', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generate(
      expectedUser,
      new DiscountFactory().generate(),
      [new ScheduleFactory().generate()]
    );

    // use pessimistic write to prevent data from being read, updated, or deleted
    await getManager().transaction(async (entityManager: EntityManager) => {
      await entityManager
        .getCustomRepository(UserRepository)
        .save(expectedUser);
      await entityManager
        .getCustomRepository(PromotionRepository)
        .save(promotion);

      return entityManager
        .createQueryBuilder()
        .setLock('pessimistic_write')
        .insert()
        .into(SavedPromotion)
        .values([
          {
            promotionId: promotion.id,
            userId: expectedUser.id,
          },
        ])
        .execute();
    });

    request(app)
      .get(`/users/${expectedUser.id}/savedPromotions`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const promotions = res.body;
        expect(promotions).toHaveLength(1);
        expect(promotions[0]).toHaveProperty('discount');
        expect(promotions[0].id).toEqual(promotion.id);
        done();
      });
  });

  test('GET /users/:id/savedPromotions - should return empty list if user has no saved promotions', async (done) => {
    const expectedUser: User = new UserFactory().generate();

    // use pessimistic write to prevent data from being read, updated, or deleted
    const insertResult = await getManager().transaction(
      async (entityManager: EntityManager) => {
        return entityManager
          .createQueryBuilder()
          .setLock('pessimistic_write')
          .insert()
          .into(User)
          .values([
            {
              ...expectedUser,
            },
          ])
          .execute();
      }
    );

    request(app)
      .get(`/users/${insertResult.identifiers[0].id}/savedPromotions`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const promotions = res.body;
        expect(promotions).toHaveLength(0);
        done();
      });
  });

  test('POST /users/:id/savedPromotions/:pid', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generate(
      expectedUser,
      new DiscountFactory().generate(),
      [new ScheduleFactory().generate()]
    );

    await userRepository.save(expectedUser);
    await promotionRepository.save(promotion);

    request(app)
      .post(`/users/${expectedUser.id}/savedPromotions/${promotion.id}`)
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);
        const savedPromotion = res.body;
        expect(savedPromotion).toMatchObject({
          userId: expectedUser.id,
          promotionId: promotion.id,
        });
        done();
      });
  });

  test('DELETE /users/:id/savedPromotions/:pid', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generate(
      expectedUser,
      new DiscountFactory().generate(),
      [new ScheduleFactory().generate()]
    );

    // use pessimistic write to prevent data from being read, updated, or deleted
    await getManager().transaction(async (entityManager: EntityManager) => {
      await entityManager
        .getCustomRepository(UserRepository)
        .save(expectedUser);
      await entityManager
        .getCustomRepository(PromotionRepository)
        .save(promotion);

      return entityManager
        .createQueryBuilder()
        .setLock('pessimistic_write')
        .insert()
        .into(SavedPromotion)
        .values([
          {
            promotionId: promotion.id,
            userId: expectedUser.id,
          },
        ])
        .execute();
    });

    request(app)
      .delete(`/users/${expectedUser.id}/savedPromotions/${promotion.id}`)
      .expect(204, done);
  });

  test('DELETE /users/:id/savedPromotions/:pid - should not fail if promotion was never saved by user', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generate(
      expectedUser,
      new DiscountFactory().generate(),
      [new ScheduleFactory().generate()]
    );

    await userRepository.save(expectedUser);
    await promotionRepository.save(promotion);

    request(app)
      .delete(`/users/${expectedUser.id}/savedPromotions/${promotion.id}`)
      .expect(204, done);
  });

  test('DELETE /users/:id/savedPromotions/:pid - should not fail if promotion and user do not exist', async (done) => {
    const nonExistentPid = '65d7bc0a-6490-4e09-82e0-cb835a64e1b8';
    const nonExistentUid = '65d7bc0a-6490-4e09-82e0-cb835a64e1b9';

    request(app)
      .delete(`/users/${nonExistentUid}/savedPromotions/${nonExistentPid}`)
      .expect(204, done);
  });

  test('GET /users/:id/uploadedPromotions', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generate(
      expectedUser,
      new DiscountFactory().generate(),
      [new ScheduleFactory().generate()]
    );

    await userRepository.save(expectedUser);
    await promotionRepository.save(promotion);

    request(app)
      .get(`/users/${expectedUser.id}/uploadedPromotions`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const user = res.body;
        expect(user).toHaveProperty('uploadedPromotions');
        compareUsers(user, expectedUser);
        expect(user.uploadedPromotions).toHaveLength(1);
        expect(user.uploadedPromotions[0]).toMatchObject({
          id: promotion.id,
          name: promotion.name,
          description: promotion.description,
        });
        done();
      });
  });

  test('GET /users/:id/uploadedPromotions - should return empty list if user has no uploaded promotions', async (done) => {
    const expectedUser: User = new UserFactory().generate();
    await userRepository.save(expectedUser);

    request(app)
      .get(`/users/${expectedUser.id}/uploadedPromotions`)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const user = res.body;
        expect(user).toHaveProperty('uploadedPromotions');
        compareUsers(user, expectedUser);
        expect(user.uploadedPromotions).toHaveLength(0);
        done();
      });
  });

  /**
   * Compare actual user against expected user
   * */
  function compareUsers(actualUser: User, expectedUser: User) {
    const expectedObject: any = { ...expectedUser };

    if (actualUser.password) {
      fail('Http request should not return password');
    }
    // since password isn't returned from http requests
    delete expectedObject.password;

    // since id is undefined in POST requests
    if (!expectedUser.id) {
      delete expectedObject.id;
    }

    expect(actualUser).toMatchObject(expectedObject);
  }
});
