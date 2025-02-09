import { getCustomRepository, getManager } from 'typeorm';
import { User } from '../../main/entity/User';
import { UserRepository } from '../../main/repository/UserRepository';
import connection from '../repository/BaseRepositoryTest';
import { Express } from 'express';
import request from 'supertest';
import { RestaurantFactory } from '../factory/RestaurantFactory';
import { SavedPromotionFactory } from '../factory/SavedPromotionFactory';
import { UserFactory } from '../factory/UserFactory';
import { BaseController } from './BaseController';
import { PromotionFactory } from '../factory/PromotionFactory';
import { PromotionRepository } from '../../main/repository/PromotionRepository';
import { DiscountType } from '../../main/data/DiscountType';
import { SortOptions } from '../../main/data/SortOptions';
import { Promotion } from '../../main/entity/Promotion';
import { VoteRecordRepository } from '../../main/repository/VoteRecordRepository';
import { VoteState } from '../../main/entity/VoteRecord';
import { RestaurantRepository } from '../../main/repository/RestaurantRepository';
import { SavedPromotionRepository } from '../../main/repository/SavedPromotionRepository';
import { randomString } from '../utility/Utility';
import { S3_BUCKET } from '../../main/service/ResourceCleanupService';
import { ErrorMessages } from '../../main/errors/ErrorMessages';

describe('Unit tests for PromotionController', function () {
  let userRepository: UserRepository;
  let promotionRepository: PromotionRepository;
  let restaurantRepository: RestaurantRepository;
  let savedPromotionRepository: SavedPromotionRepository;
  let app: Express;
  let baseController: BaseController;

  beforeAll(async () => {
    await connection.create();
    baseController = new BaseController();
    app = await baseController.registerTestApplication();
  });

  afterAll(async () => {
    await connection.close();
    await baseController.quit();
  });

  beforeEach(async () => {
    await connection.clear();
    await baseController.createAuthenticatedUser();
    userRepository = getCustomRepository(UserRepository);
    promotionRepository = getCustomRepository(PromotionRepository);
    restaurantRepository = getCustomRepository(RestaurantRepository);
    savedPromotionRepository = getCustomRepository(SavedPromotionRepository);
  });

  afterEach(async () => {
    await baseController.deleteAuthenticatedUser();
  });

  test('GET /promotions', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);

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

    const promotion1 = new PromotionFactory().generateWithRelatedEntities(user);
    const promotion2 = new PromotionFactory().generateWithRelatedEntities(user);

    promotion1.discount.discountType = DiscountType.PERCENTAGE;
    promotion2.discount.discountType = DiscountType.AMOUNT;

    await userRepository.save(user);
    await promotionRepository.save(promotion1);
    await promotionRepository.save(promotion2);

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

    const promotion1 = new PromotionFactory().generateWithRelatedEntities(user);
    const promotion2 = new PromotionFactory().generateWithRelatedEntities(user);
    const promotion3 = new PromotionFactory().generateWithRelatedEntities(user);

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

  test('GET /promotions - sort by distance', async (done) => {
    const user: User = new UserFactory().generate();

    const restaurants = [
      new RestaurantFactory().generate(undefined, 0, 0),
      new RestaurantFactory().generate(undefined, 49, -123),
      new RestaurantFactory().generate(undefined, 50, -100),
    ];

    // In order of closest restaurant to user
    const expectedPromotions = [
      new PromotionFactory().generateWithRelatedEntities(user, restaurants[1]),
      new PromotionFactory().generateWithRelatedEntities(user, restaurants[2]),
      new PromotionFactory().generateWithRelatedEntities(user, restaurants[0]),
    ];

    await userRepository.save(user);
    await Promise.all(
      restaurants.map((restaurant) => restaurantRepository.save(restaurant))
    );
    await Promise.all(
      expectedPromotions.map((promotion) => promotionRepository.save(promotion))
    );

    request(app)
      .get('/promotions')
      .query({
        sort: SortOptions.DISTANCE,
        lat: 49.282,
        lon: -123.1171,
      })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const promotions = res.body;
        expect(promotions).toHaveLength(3);
        promotions.forEach((promotion: Promotion, index: number) => {
          // expected promotions should be same order as promotions returned
          comparePromotions(promotion, expectedPromotions[index]);
        });
        done();
      });
  });

  test('GET /promotions - sort by popularity', async (done) => {
    // Note: only able to test sorting based on number of likes; unable to factor in time periods
    // because the date_added column is created upon insertion

    const users = [
      new UserFactory().generate(),
      new UserFactory().generate(),
      new UserFactory().generate(),
    ];

    const expectedPromotions = [
      new PromotionFactory().generateWithRelatedEntities(users[0]),
      new PromotionFactory().generateWithRelatedEntities(users[0]),
      new PromotionFactory().generateWithRelatedEntities(users[0]),
    ];

    const savedPromotions = [
      new SavedPromotionFactory().generate(users[0], expectedPromotions[0]),
      new SavedPromotionFactory().generate(users[0], expectedPromotions[1]),
      new SavedPromotionFactory().generate(users[1], expectedPromotions[0]),
      new SavedPromotionFactory().generate(users[1], expectedPromotions[1]),
      new SavedPromotionFactory().generate(users[1], expectedPromotions[2]),
      new SavedPromotionFactory().generate(users[2], expectedPromotions[0]),
    ];

    await Promise.all(users.map((user) => userRepository.save(user)));
    await Promise.all(
      expectedPromotions.map((promotion) => promotionRepository.save(promotion))
    );
    await Promise.all(
      savedPromotions.map((save) => savedPromotionRepository.save(save))
    );

    request(app)
      .get('/promotions')
      .query({
        sort: SortOptions.POPULARITY,
      })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const promotions = res.body;
        expect(promotions).toHaveLength(3);
        promotions.forEach((promotion: Promotion, index: number) => {
          comparePromotions(promotion, expectedPromotions[index]);
        });
        done();
      });
  });

  test('GET /promotions - sort by recency', async (done) => {
    const user: User = new UserFactory().generate();

    const expectedPromotions = [
      new PromotionFactory().generateWithRelatedEntities(user),
      new PromotionFactory().generateWithRelatedEntities(user),
      new PromotionFactory().generateWithRelatedEntities(user),
    ];

    await userRepository.save(user);
    await promotionRepository.save(expectedPromotions[0]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await promotionRepository.save(expectedPromotions[1]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await promotionRepository.save(expectedPromotions[2]);

    request(app)
      .get('/promotions')
      .query({
        sort: SortOptions.POPULARITY,
      })
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const promotions = res.body;
        expect(promotions).toHaveLength(3);
        promotions.forEach((promotion: Promotion, index: number) => {
          comparePromotions(promotion, expectedPromotions[index]);
        });
        done();
      });
  });

  test('GET /promotions/:id', async (done) => {
    const user: User = new UserFactory().generate();
    const expectedPromotion = new PromotionFactory().generateWithRelatedEntities(
      user
    );

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
    const expectedPromotion = new PromotionFactory().generateWithRelatedEntities(
      user
    );
    const inputtedPromotion = setAddress(expectedPromotion);

    await userRepository.save(user);
    request(app)
      .post('/promotions')
      .send({
        ...inputtedPromotion,
        user: undefined,
        userId: user.id,
        restaurant: undefined,
        placeId: expectedPromotion.restaurant.placeId,
      })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);
        const promotion = res.body;

        // these values are null because the inputted promotion address is an invalid location
        expect(promotion.restaurant.lat).toEqual(null);
        expect(promotion.restaurant.lon).toEqual(null);

        comparePromotions(promotion, expectedPromotion);
        done();
      });
  });

  test('POST /promotions/ - invalid request body should be caught', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);
    const inputtedPromotion = setAddress(promotion);

    await userRepository.save(user);
    request(app)
      .post('/promotions')
      .send({
        ...inputtedPromotion,
        user: undefined,
        userId: user.id,
        cuisine: 'nonexistentcuisinetype',
        restaurant: undefined,
        placeId: promotion.restaurant.placeId,
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

  test('POST /promotions/ - should not be able to add promotion if user does not exist', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);
    const inputtedPromotion = setAddress(promotion);

    request(app)
      .post('/promotions')
      .send({
        ...inputtedPromotion,
        restaurant: undefined,
        user: undefined,
        userId: '65d7bc0a-6490-4e09-82e0-cb835a64e1b8', // non-existent user UUID
        placeId: promotion.restaurant.placeId,
      })
      .expect(400)
      .end((err, res) => {
        const frontEndErrorObject = res.body;
        expect(frontEndErrorObject?.errorCode).toEqual('EntityNotFound');
        expect(frontEndErrorObject.message).toHaveLength(1);
        expect(frontEndErrorObject.message[0]).toContain(
          'Could not find any entity of type "User"'
        );
        done();
      });
  });

  test('POST /promotions/ - should not be able to add promotion if address is an empty string', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);
    const inputtedPromotion = { ...promotion, address: '' };

    await userRepository.save(user);

    request(app)
      .post('/promotions')
      .send({
        ...inputtedPromotion,
        restaurant: undefined,
        user: undefined,
        userId: '65d7bc0a-6490-4e09-82e0-cb835a64e1b8', // non-existent user UUID
        placeId: promotion.restaurant.placeId,
      })
      .expect(400)
      .end((err, res) => {
        const frontEndErrorObject = res.body;
        expect(frontEndErrorObject?.errorCode).toEqual('ValidationError');
        expect(frontEndErrorObject.message).toHaveLength(1);
        expect(frontEndErrorObject.message[0]).toContain(
          '"address" is not allowed to be empty'
        );
        done();
      });
  });

  test('POST /promotions/ - if restaurant with same placeId exists in DB, promotion should reference that restaurant', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);
    const inputtedPromotion = setAddress(promotion);

    // save a promotion with a restaurant
    const existingPromotion = new PromotionFactory().generateWithRelatedEntities(
      user
    );
    const existingRestaurant = existingPromotion.restaurant;

    await userRepository.save(user);
    await promotionRepository.save(existingPromotion);

    request(app)
      .post('/promotions')
      .send({
        ...inputtedPromotion,
        restaurant: undefined,
        user: undefined,
        userId: user.id,
        placeId: existingRestaurant.placeId,
      })
      .expect(201)
      .end((err, res) => {
        if (err) return done(err);
        const promotion = res.body as Promotion;
        expect(promotion.restaurant).toEqual(existingRestaurant);
        done();
      });
  });

  test('POST /promotions/ - if restaurant with placeId does not exist in DB, promotion should create new restaurant', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);
    const inputtedPromotion = setAddress(promotion);

    await userRepository.save(user);

    request(app)
      .post('/promotions')
      .send({
        ...inputtedPromotion,
        restaurant: undefined,
        user: undefined,
        userId: user.id,
        placeId: promotion.restaurant.placeId,
      })
      .expect(201)
      .end(async (err, res) => {
        if (err) return done(err);
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            const restaurants = await transactionalEntityManager
              .getCustomRepository(RestaurantRepository)
              .find();
            expect(restaurants).toHaveLength(1);

            const actualPromotion = res.body;

            // these values are null because the inputted promotion address is an invalid location
            expect(actualPromotion.restaurant.lat).toEqual(null);
            expect(actualPromotion.restaurant.lon).toEqual(null);

            comparePromotions(actualPromotion, promotion);
            done();
          }
        );
      });
  });

  test('POST /promotions/ - geocoder should create a new valid restaurant', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);
    const inputtedPromotion = {
      ...promotion,
      address: '780 Bidwell St, Vancouver, BC V6G 2J6',
    };

    await userRepository.save(user);

    request(app)
      .post('/promotions')
      .send({
        ...inputtedPromotion,
        restaurant: undefined,
        user: undefined,
        userId: user.id,
        placeId: promotion.restaurant.placeId,
      })
      .expect(201)
      .end(async (err, res) => {
        if (err) return done(err);
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            const restaurants = await transactionalEntityManager
              .getCustomRepository(RestaurantRepository)
              .find();
            expect(restaurants).toHaveLength(1);

            const actualPromotion = res.body;

            expect(actualPromotion.restaurant.lat).toEqual(49.2906033);
            expect(actualPromotion.restaurant.lon).toEqual(-123.1333902);

            comparePromotions(actualPromotion, promotion);
            done();
          }
        );
      });
  });

  test('DELETE /promotions/:id', async (done) => {
    const promotion = new PromotionFactory().generateWithRelatedEntities(
      baseController.authenticatedUser
    );
    await promotionRepository.save(promotion);

    request(app)
      .delete(`/promotions/${promotion.id}`)
      .set('Authorization', baseController.idToken)
      .expect(204)
      .then(() => {
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            // check that promotion no longer exists
            const promotionRepository = transactionalEntityManager.getCustomRepository(
              PromotionRepository
            );
            await expect(
              promotionRepository.findOneOrFail({ id: promotion.id })
            ).rejects.toThrowError();
            done();
          }
        );
      });
  });

  test('DELETE /promotions/:id - should not be able to delete a promotion that is not uploaded by the user', async (done) => {
    const userWhoUploadedPromotion: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(
      userWhoUploadedPromotion
    );
    await userRepository.save(userWhoUploadedPromotion);
    await promotionRepository.save(promotion);

    // BaseController.authenticatedUser is trying to delete another users promotion
    request(app)
      .delete(`/promotions/${promotion.id}`)
      .set('Authorization', baseController.idToken)
      .expect(204)
      .end((error, res) => {
        const frontEndErrorObject = res.body;
        expect(frontEndErrorObject?.errorCode).toEqual('ForbiddenError');
        expect(frontEndErrorObject.message).toHaveLength(1);
        expect(frontEndErrorObject.message[0]).toEqual(
          ErrorMessages.INSUFFICIENT_PRIVILEGES
        );
        done();
      });
  });

  test('POST /promotions/:id/upVote', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);

    await userRepository.save(user);
    await promotionRepository.save(promotion);

    const votingUser: User = new UserFactory().generate();
    await userRepository.save(votingUser);

    request(app)
      .post(`/promotions/${promotion.id}/upVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204)
      .then(() => {
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            // check that promotion votes has incremented
            const promotionRepository = transactionalEntityManager.getCustomRepository(
              PromotionRepository
            );
            const voteRecordRepository = transactionalEntityManager.getCustomRepository(
              VoteRecordRepository
            );
            const newPromotion = await promotionRepository.findOneOrFail(
              promotion.id
            );
            const newVoteRecord = await voteRecordRepository.findOneOrFail({
              userId: votingUser.id,
              promotionId: promotion.id,
            });
            expect(newPromotion.votes).toEqual(1);
            expect(newVoteRecord).toBeDefined();
            expect(newVoteRecord.voteState).toEqual(VoteState.UP);
            done();
          }
        );
      });
  });

  test('POST /promotions/:id/downVote', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);

    await userRepository.save(user);
    await promotionRepository.save(promotion);

    const votingUser: User = new UserFactory().generate();
    await userRepository.save(votingUser);

    request(app)
      .post(`/promotions/${promotion.id}/downVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204)
      .then(() => {
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            // check that promotion votes has decremented
            const promotionRepository = transactionalEntityManager.getCustomRepository(
              PromotionRepository
            );
            const voteRecordRepository = transactionalEntityManager.getCustomRepository(
              VoteRecordRepository
            );
            const newPromotion = await promotionRepository.findOneOrFail(
              promotion.id
            );
            const newVoteRecord = await voteRecordRepository.findOneOrFail({
              userId: votingUser.id,
              promotionId: promotion.id,
            });
            expect(newPromotion.votes).toEqual(-1);
            expect(newVoteRecord).toBeDefined();
            expect(newVoteRecord.voteState).toEqual(VoteState.DOWN);
            done();
          }
        );
      });
  });

  test('POST /promotions/:id/upVote - voting to become INIT', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);

    await userRepository.save(user);
    await promotionRepository.save(promotion);

    const votingUser: User = new UserFactory().generate();
    await userRepository.save(votingUser);

    await request(app)
      .post(`/promotions/${promotion.id}/upVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204);
    // second time
    request(app)
      .post(`/promotions/${promotion.id}/upVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204)
      .then(() => {
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            // check that promotion votes has incremented
            const promotionRepository = transactionalEntityManager.getCustomRepository(
              PromotionRepository
            );
            const voteRecordRepository = transactionalEntityManager.getCustomRepository(
              VoteRecordRepository
            );
            const newPromotion = await promotionRepository.findOneOrFail(
              promotion.id
            );
            const newVoteRecord = await voteRecordRepository.findOneOrFail({
              userId: votingUser.id,
              promotionId: promotion.id,
            });
            expect(newPromotion.votes).toEqual(0);
            expect(newVoteRecord).toBeDefined();
            expect(newVoteRecord.voteState).toEqual(VoteState.INIT);
            done();
          }
        );
      });
  });

  test('POST /promotions/:id/downVote - voting to become INIT', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);

    await userRepository.save(user);
    await promotionRepository.save(promotion);

    const votingUser: User = new UserFactory().generate();
    await userRepository.save(votingUser);

    await request(app)
      .post(`/promotions/${promotion.id}/downVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204);
    // second time
    request(app)
      .post(`/promotions/${promotion.id}/downVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204)
      .then(() => {
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            // check that promotion votes has incremented
            const promotionRepository = transactionalEntityManager.getCustomRepository(
              PromotionRepository
            );
            const voteRecordRepository = transactionalEntityManager.getCustomRepository(
              VoteRecordRepository
            );
            const newPromotion = await promotionRepository.findOneOrFail(
              promotion.id
            );
            const newVoteRecord = await voteRecordRepository.findOneOrFail({
              userId: votingUser.id,
              promotionId: promotion.id,
            });
            expect(newPromotion.votes).toEqual(0);
            expect(newVoteRecord).toBeDefined();
            expect(newVoteRecord.voteState).toEqual(VoteState.INIT);
            done();
          }
        );
      });
  });

  test('POST /promotions/:id/upVote - voting to become DOWN from UP', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);

    await userRepository.save(user);
    await promotionRepository.save(promotion);

    const votingUser: User = new UserFactory().generate();
    await userRepository.save(votingUser);

    await request(app)
      .post(`/promotions/${promotion.id}/upVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204);
    // second time
    request(app)
      .post(`/promotions/${promotion.id}/downVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204)
      .then(() => {
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            // check that promotion votes has incremented
            const promotionRepository = transactionalEntityManager.getCustomRepository(
              PromotionRepository
            );
            const voteRecordRepository = transactionalEntityManager.getCustomRepository(
              VoteRecordRepository
            );
            const newPromotion = await promotionRepository.findOneOrFail(
              promotion.id
            );
            const newVoteRecord = await voteRecordRepository.findOneOrFail({
              userId: votingUser.id,
              promotionId: promotion.id,
            });
            expect(newPromotion.votes).toEqual(-1);
            expect(newVoteRecord).toBeDefined();
            expect(newVoteRecord.voteState).toEqual(VoteState.DOWN);
            done();
          }
        );
      });
  });

  test('POST /promotions/:id/downVote - voting to become UP from DOWN', async (done) => {
    const user: User = new UserFactory().generate();
    const promotion = new PromotionFactory().generateWithRelatedEntities(user);

    await userRepository.save(user);
    await promotionRepository.save(promotion);

    const votingUser: User = new UserFactory().generate();
    await userRepository.save(votingUser);

    await request(app)
      .post(`/promotions/${promotion.id}/downVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204);
    // second time
    request(app)
      .post(`/promotions/${promotion.id}/upVote`)
      .send({
        uid: votingUser.id,
      })
      .expect(204)
      .then(() => {
        return getManager().transaction(
          'READ UNCOMMITTED',
          async (transactionalEntityManager) => {
            // check that promotion votes has incremented
            const promotionRepository = transactionalEntityManager.getCustomRepository(
              PromotionRepository
            );
            const voteRecordRepository = transactionalEntityManager.getCustomRepository(
              VoteRecordRepository
            );
            const newPromotion = await promotionRepository.findOneOrFail(
              promotion.id
            );
            const newVoteRecord = await voteRecordRepository.findOneOrFail({
              userId: votingUser.id,
              promotionId: promotion.id,
            });
            expect(newPromotion.votes).toEqual(1);
            expect(newVoteRecord).toBeDefined();
            expect(newVoteRecord.voteState).toEqual(VoteState.UP);
            done();
          }
        );
      });
  });

  test('DELETE /promotions/:id should cleanup external resources of a promotion such as s3 object', async (done) => {
    const expectedObject = '{"hello": false}';
    const promotion = new PromotionFactory().generateWithRelatedEntities(
      baseController.authenticatedUser
    );
    await promotionRepository.save(promotion);

    await baseController.mockS3
      .putObject({ Key: promotion.id, Body: expectedObject, Bucket: S3_BUCKET })
      .promise();
    // check object put correctly
    const object = await baseController.mockS3
      .getObject({ Key: promotion.id, Bucket: S3_BUCKET })
      .promise();
    expect(object.Body!.toString()).toEqual(expectedObject);

    request(app)
      .delete(`/promotions/${promotion.id}`)
      .set('Authorization', baseController.idToken)
      .expect(204)
      .then(async () => {
        try {
          await baseController.mockS3
            .getObject({ Key: promotion.id, Bucket: S3_BUCKET })
            .promise();
          fail('Should have thrown error');
        } catch (e) {
          expect(e.code).toEqual('NoSuchKey');
          done();
        }
      });
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

    if (expectedPromotion.restaurant) {
      const restaurantObject: any = { ...expectedPromotion.restaurant };

      if (!expectedPromotion.restaurant.id) {
        delete restaurantObject.id;
      }

      // comparisons will occur in individual test cases as RestaurantFactory generates random values
      delete restaurantObject.lat;
      delete restaurantObject.lon;

      expect(actualPromotion.restaurant).toMatchObject(restaurantObject);
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

  /**
   * Sets the address field for the promotion
   */
  function setAddress(promotion: Promotion) {
    const result: any = { ...promotion };
    result.address = randomString(30);
    return result;
  }
});
