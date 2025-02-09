import {
  EntityRepository,
  getConnection,
  In,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Promotion } from '../entity/Promotion';
import { PromotionQueryDTO } from '../validation/PromotionQueryValidation';
import { Schedule } from '../entity/Schedule';
import { VoteState } from '../entity/VoteRecord';
import { VoteRecordRepository } from './VoteRecordRepository';
import { SavedPromotionRepository } from './SavedPromotionRepository';
import { SavedPromotion } from '../entity/SavedPromotion';
import { SortOptions } from '../data/SortOptions';

/* eslint-disable  @typescript-eslint/explicit-module-boundary-types */
@EntityRepository(Promotion)
export class PromotionRepository extends Repository<Promotion> {
  /**
   * Gets all promotions by constructing a query builder.
   * * Depending on whether promotionQuery has any content, we will need to apply the necessary operations on top of
   * the queryBuilder in order to support filtering operations
   * */
  async getAllPromotions(promotionQuery?: PromotionQueryDTO): Promise<any> {
    if (
      promotionQuery &&
      JSON.stringify(promotionQuery) !== JSON.stringify({})
    ) {
      let promotions: Promotion[] = await this.applyQueryOptions(
        promotionQuery
      );
      if (promotionQuery.userId && promotions.length) {
        promotions = await this.findPromotionsUserSaved(
          promotionQuery.userId,
          promotions
        );
        return this.findPromotionsUserVoted(promotionQuery.userId, promotions);
      }
      return promotions;
    } else {
      return this.createQueryBuilder('promotion')
        .innerJoinAndSelect('promotion.discount', 'discount')
        .innerJoinAndSelect('promotion.restaurant', 'restaurant')
        .innerJoinAndSelect('promotion.schedules', 'schedule')
        .cache(true) // https://typeorm.io/#/caching Any promotions added within the 1 second cache window won't be returned to the user
        .getMany();
    }
  }

  /**
   * Depending on which properties are defined inside promotionQuery, we add those properties into our query for the queryBuilder to execute.
   */
  private applyQueryOptions(
    promotionQuery: PromotionQueryDTO
  ): Promise<Promotion[] | PromotionFullTextSearch[]> {
    const queryBuilder = this.createQueryBuilder('promotion')
      .innerJoinAndSelect('promotion.discount', 'discount')
      .innerJoinAndSelect('promotion.restaurant', 'restaurant')
      .innerJoinAndSelect('promotion.schedules', 'schedule');

    if (promotionQuery?.promotionType) {
      queryBuilder.andWhere('promotion.promotionType = :promotionType', {
        promotionType: promotionQuery.promotionType,
      });
    }

    if (promotionQuery?.cuisine) {
      if (Array.isArray(promotionQuery.cuisine)) {
        // https://github.com/typeorm/typeorm/issues/1239#issuecomment-366955628
        if (promotionQuery.cuisine.length > 0) {
          queryBuilder.andWhere('promotion.cuisine in (:...cuisine)', {
            cuisine: promotionQuery.cuisine,
          });
        }
      } else {
        queryBuilder.andWhere('promotion.cuisine = :cuisine', {
          cuisine: promotionQuery.cuisine,
        });
      }
    }

    if (promotionQuery?.discountType) {
      queryBuilder.andWhere('discount.discountType = :discountType', {
        discountType: promotionQuery.discountType,
      });

      /**
       * We only want to filter for discountValue if we know the user requested a discountType.
       * Although this is already validated by the validation schema for PromotionQueryDTO, we just want to be extra sure
       * */
      if (promotionQuery?.discountValue) {
        queryBuilder.andWhere('discount.discountValue >= :discountValue', {
          discountValue: promotionQuery.discountValue,
        });
      }
    }

    // see https://github.com/ubclaunchpad/foodies/issues/54
    if (promotionQuery?.expirationDate) {
      queryBuilder.andWhere(
        "promotion.expirationDate ::timestamptz at time zone 'UTC' >= :date ::timestamptz at time zone 'UTC'",
        {
          date: promotionQuery.expirationDate,
        }
      );
    }

    if (promotionQuery?.dayOfWeek) {
      // use a subQuery so that we still return all the schedules of a promotion
      queryBuilder.andWhere(
        (qb) => {
          const subQuery = qb
            .subQuery()
            .select('S.promotionId')
            .from(Schedule, 'S')
            .where('S.dayOfWeek = :dayOfWeek')
            .getQuery();
          return 'promotion.id in ' + subQuery;
        },
        {
          dayOfWeek: promotionQuery.dayOfWeek,
        }
      );
    }

    if (promotionQuery?.searchQuery) {
      return this.fullTextSearch(queryBuilder, promotionQuery);
    }

    if (promotionQuery?.sort) {
      this.addSortOptions(queryBuilder, promotionQuery);
    }

    return queryBuilder.cache(true).getMany();
  }

  private async fullTextSearch(
    queryBuilder: SelectQueryBuilder<Promotion>,
    promotionQuery: PromotionQueryDTO
  ): Promise<PromotionFullTextSearch[]> {
    // todo: modify searchQuery accordingly
    // todo: decide how to handle special characters (e.g. single quotes, AT&T as a single word)

    const fullTextSearchResults: FullTextSearchInterface[] = await this.createQueryBuilder(
      'promotion'
    )
      .select('promotion.id', 'id')
      .addSelect(
        "ts_rank_cd(tsvector, replace(plainto_tsquery(:searchQuery)::text, '&', '|')::tsquery)",
        'rank'
      )
      .addSelect(
        "ts_headline(description, replace(plainto_tsquery(:searchQuery)::text, '&', '|')::tsquery, 'MaxFragments=3')",
        'boldDescription'
      )
      // todo: double check, if we set max length for title we can use HighlightAll, otherwise we can use MaxWords/MinWords as well
      .addSelect(
        "ts_headline(name, replace(plainto_tsquery(:searchQuery)::text, '&', '|')::tsquery, 'HighlightAll=true')",
        'boldName'
      )
      .where(
        "tsvector @@ replace(plainto_tsquery(:searchQuery)::text, '&', '|')::tsquery",
        {
          searchQuery: promotionQuery.searchQuery,
        }
      )
      .orderBy('rank', 'DESC')
      .getRawMany();

    if (!fullTextSearchResults?.length) {
      return [];
    }

    // todo: can we optimize this? Although the id column is already index (b/c primary key)
    const promotions: Promotion[] = await queryBuilder
      .andWhere('promotion.id IN (:...ids)', {
        ids: fullTextSearchResults.map((idRank) => idRank.id),
      })
      .getMany();

    if (!promotions?.length) {
      return [];
    }

    const mapIdToPromotion: Map<string, Promotion> = new Map(
      promotions.map((promotion) => [promotion.id, promotion])
    );

    const result: PromotionFullTextSearch[] = [];
    for (const fullTextSearchResult of fullTextSearchResults) {
      const promotion = mapIdToPromotion.get(fullTextSearchResult.id);
      if (promotion) {
        const promotionWithRank: PromotionFullTextSearch = {
          ...promotion,
          rank: fullTextSearchResult.rank,
          boldDescription: fullTextSearchResult.boldDescription,
          boldName: fullTextSearchResult.boldName,
        };
        result.push(promotionWithRank);
      }
    }

    return result;
  }

  private addSortOptions(
    queryBuilder: SelectQueryBuilder<Promotion>,
    promotionQuery: PromotionQueryDTO
  ): SelectQueryBuilder<Promotion> {
    switch (promotionQuery.sort) {
      case SortOptions.DISTANCE: {
        if (promotionQuery?.lat && promotionQuery?.lon) {
          queryBuilder
            .addSelect(
              // Note: formatted as (lon, lat) because this is more similar to the cartesian axes (x, y)
              `point (restaurant.lon, restaurant.lat) <@> point (${promotionQuery.lon}, ${promotionQuery.lat})`,
              'distance'
            )
            .orderBy('distance', 'ASC');
        }
        break;
      }
      case SortOptions.POPULARITY:
        /**
         * Calculates a "popularity score" for each promotion based on the recency of saves.
         * This query gives higher weight to promotions that have been recently saved in the past month.
         */
        queryBuilder
          .addSelect((qb) => {
            /**
             * The sub-query finds the savedPromotion entries for each promotion and assigns a weight to them
             * based on how long ago the entry was created (i.e. date saved):
             *
             * [5 points]: dateSaved <= 1 month
             * [4 points]: 1 month < dateSaved <= 3 months
             * [3 points]: 3 months < dateSaved <= 6 months
             * [2 points]: 6 months < dateSaved <= 1 year
             * [1 points]: dateSaved > 1 year
             */
            return qb
              .subQuery()
              .select(
                `SUM(
                    CASE
                      WHEN SP.dateSaved >= NOW() - INTERVAL '1 month' THEN 5
                      WHEN SP.dateSaved >= NOW() - INTERVAL '3 months' AND
                        SP.dateSaved < NOW() - INTERVAL '1 month' THEN 4
                      WHEN SP.dateSaved >= NOW() - INTERVAL '6 months' AND
                        SP.dateSaved < NOW() - INTERVAL '6 months' THEN 3
                      WHEN SP.dateSaved >= NOW() - INTERVAL '1 year' THEN 2
                      ELSE 1
                    END
                  )`,
                'score'
              )
              .from(SavedPromotion, 'SP')
              .groupBy('SP.promotionId')
              .where('"promotion"."id" = "SP"."promotionId"');
          }, 'popularity')
          .orderBy('popularity', 'DESC');
        break;
      case SortOptions.RECENCY:
        queryBuilder.addOrderBy('date_added', 'DESC');
        break;
      default:
      // No modifications to query
    }

    return queryBuilder;
  }

  /**
   * Find all promotions saved by user and set {@link Promotion.isSavedByUser} respectively.
   * More specifically, look into saved promotion table and find entries with matching userId and with promotionId in the id's of promotions
   * @param userId the id of the user
   * @param promotions the promotions we want to find out if the user saved
   * */
  async findPromotionsUserSaved(
    userId: string,
    promotions: Promotion[]
  ): Promise<Promotion[]> {
    const promotionIds = promotions.map((promotion: Promotion) => promotion.id);
    const savedPromotions = await getConnection()
      .getCustomRepository(SavedPromotionRepository)
      .find({
        select: ['promotionId'],
        where: {
          userId,
          promotionId: In(promotionIds),
        },
      });
    const set = new Set(
      savedPromotions.map((savedPromotion) => savedPromotion.promotionId)
    );
    return promotions.map((promotion: Promotion) => {
      promotion.isSavedByUser = set.has(promotion.id);
      return promotion;
    });
  }

  /**
   * Like as we did in findPromotionUserSaved, check all promotions is voted by the user
   * @param userId the id of the user
   * @param promotions the promotions we want to find out if the user voted
   */
  async findPromotionsUserVoted(
    userId: string,
    promotions: Promotion[]
  ): Promise<Promotion[]> {
    const promotionIds = promotions.map((promotion: Promotion) => promotion.id);
    const voteRecords = await getConnection()
      .getCustomRepository(VoteRecordRepository)
      .find({
        select: ['promotionId', 'voteState'],
        where: {
          userId,
          promotionId: In(promotionIds),
        },
      });
    // todo: I could not find way to initialize Map using map function, so using for loop
    const promotionIdToVoteState = new Map<string, number>(
      voteRecords.map((voteRecord) => {
        return [voteRecord['promotionId'], voteRecord['voteState']];
      })
    );
    return promotions.map((promotion: Promotion) => {
      promotion.voteState =
        promotionIdToVoteState.get(promotion.id) ?? VoteState.INIT;
      return promotion;
    });
  }
}

/**
 * Represents results returned from postgres full text search.
 * * rank - scale for how relevant promotion matches the search query
 * * boldName and boldDescription - postgres highlights areas that match the search query
 * */
interface FullTextSearchInterface {
  id: string;
  rank: number;
  boldName: string;
  boldDescription: string;
}

/**
 * Used only for full text search when client applies search query options to get promotions
 * * rank - represents how relevant documents are to a particular query, so that the most relevant one can be shown
 * * boldName and boldDescription - postgres highlights areas that match the search query
 * */
export interface PromotionFullTextSearch extends Promotion {
  rank: number;
  boldName: string;
  boldDescription: string;
}
