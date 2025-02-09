import { NextFunction, Request, Response } from 'express';
import { EntityManager, getManager } from 'typeorm';
import { IdValidation } from '../validation/IdValidation';
import { GooglePlacesService } from '../service/GooglePlacesService';
import { Place, Status } from '@googlemaps/google-maps-services-js';
import { RestaurantRepository } from '../repository/RestaurantRepository';
import { PromotionRepository } from '../repository/PromotionRepository';

export class RestaurantController {
  private googlePlacesService: GooglePlacesService;

  constructor(googlePlacesService: GooglePlacesService) {
    this.googlePlacesService = googlePlacesService;
  }

  /**
   * Get all the promotions for a restaurant
   */
  getPromotions = async (
    request: Request,
    response: Response,
    next: NextFunction
  ): Promise<any> => {
    try {
      await getManager().transaction(async (transactionalEntityManager) => {
        const id = await IdValidation.schema.validateAsync(request.params.id, {
          abortEarly: false,
        });

        // find all promotions who have the same restaurantId
        const promotions = await transactionalEntityManager
          .getCustomRepository(PromotionRepository)
          .createQueryBuilder('promotion')
          .innerJoinAndSelect('promotion.discount', 'discount')
          .innerJoinAndSelect('promotion.schedules', 'schedule')
          .where('promotion.restaurantId = :id', { id })
          .cache(true)
          .getMany();

        return response.status(200).send(promotions);
      });
    } catch (e) {
      return next(e);
    }
  };

  /* *
   * Get the restaurant details of a restaurant
   */
  getRestaurantDetails = async (
    request: Request,
    response: Response,
    next: NextFunction
  ): Promise<any> => {
    try {
      await getManager().transaction(async (transactionalEntityManager) => {
        let result: Place = {};
        const id = await IdValidation.schema.validateAsync(request.params.id, {
          abortEarly: false,
        });

        const restaurant = await transactionalEntityManager
          .getCustomRepository(RestaurantRepository)
          .findOneOrFail(id);

        // placeId may be empty string if this restaurant has previously resulted in a NOT_FOUND even after refresh request
        if (restaurant.placeId) {
          const placeDetailsResponseData = await this.googlePlacesService.getRestaurantDetails(
            restaurant.placeId
          );
          result = placeDetailsResponseData.result ?? {};

          if (placeDetailsResponseData.status === Status.NOT_FOUND) {
            result = await this.handlePlaceIdNotFound(
              restaurant.placeId,
              id,
              transactionalEntityManager
            );
          }
        }

        return response.status(200).send(result);
      });
    } catch (e) {
      return next(e);
    }
  };

  /**
   * Handle NOT_FOUND case for getting restaurant details of a placeId for a restaurant
   * 1. Issue refresh request for the placeId
   * 2. Store new placeId in DB, even if placeId is empty string
   * @param placeId the placeId of the restaurant
   * @param id the id of the restaurant
   * @param transactionalEntityManager
   * @return Place - the restaurant details which may be empty
   * */
  private async handlePlaceIdNotFound(
    placeId: string,
    id: string,
    transactionalEntityManager: EntityManager
  ): Promise<Place> {
    const refreshResult = await this.googlePlacesService.refreshPlaceId(
      placeId
    );

    // update DB with new placeId, even if placeId is empty string
    await transactionalEntityManager
      .getCustomRepository(RestaurantRepository)
      .update({ id }, { placeId: refreshResult.placeId });

    return refreshResult.restaurantDetails;
  }
}
