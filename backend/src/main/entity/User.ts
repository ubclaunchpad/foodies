import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Promotion } from './Promotion';
import { SavedPromotion } from './SavedPromotion';

/*
 * Represents a user in our application.
 * * Each user can upload/save many promotions
 * */
@Entity('user_profile')
export class User {
  constructor(
    firstName: string,
    lastName: string,
    email: string,
    username: string,
    password: string
  ) {
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.username = username;
    this.password = password;
  }

  @PrimaryGeneratedColumn('uuid')
  id: string;

  /*
   * OneToMany bidirectional relationship between User and Promotion
   * Each user can upload 0 or more promotions.
   * */
  @OneToMany(() => Promotion, (promotion) => promotion.user, {
    cascade: true,
  })
  uploadedPromotions: Promotion[];

  /*
   * ManyToMany bidirectional relationship between User and Promotion
   * SavedPromotion is the join table with custom properties
   * Each user can save 0 or more promotions
   * */
  @OneToMany(() => SavedPromotion, (savedPromotion) => savedPromotion.user, {
    cascade: true,
  })
  savedPromotions: SavedPromotion[];

  @Column({
    name: 'first_name',
  })
  firstName: string;

  @Column({
    name: 'last_name',
  })
  lastName: string;

  @Column({
    unique: true,
  })
  email: string;

  @Column({
    unique: true,
  })
  username: string;

  // todo: we need something more secure
  @Column({
    unique: true,
    select: false, // https://typeorm.io/#/select-query-builder/hidden-columns
  })
  password: string;
}
