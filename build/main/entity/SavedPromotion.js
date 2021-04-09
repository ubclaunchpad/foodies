"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SavedPromotion = void 0;
const typeorm_1 = require("typeorm");
const User_1 = require("./User");
const Promotion_1 = require("./Promotion");
let SavedPromotion = class SavedPromotion {
    constructor(user, promotion) {
        this.user = user;
        this.promotion = promotion;
    }
};
__decorate([
    typeorm_1.Index(),
    typeorm_1.PrimaryColumn(),
    __metadata("design:type", String)
], SavedPromotion.prototype, "userId", void 0);
__decorate([
    typeorm_1.Index(),
    typeorm_1.PrimaryColumn(),
    __metadata("design:type", String)
], SavedPromotion.prototype, "promotionId", void 0);
__decorate([
    typeorm_1.CreateDateColumn({
        name: 'date_saved',
        type: 'timestamptz',
        default: () => 'CURRENT_TIMESTAMP',
    }),
    __metadata("design:type", Date)
], SavedPromotion.prototype, "dateSaved", void 0);
__decorate([
    typeorm_1.ManyToOne(() => User_1.User, (user) => user.savedPromotions, {
        onDelete: 'CASCADE',
    }),
    __metadata("design:type", User_1.User)
], SavedPromotion.prototype, "user", void 0);
__decorate([
    typeorm_1.ManyToOne(() => Promotion_1.Promotion, (promotion) => promotion.savedBy, {
        onDelete: 'CASCADE',
    }),
    __metadata("design:type", Promotion_1.Promotion)
], SavedPromotion.prototype, "promotion", void 0);
SavedPromotion = __decorate([
    typeorm_1.Entity(),
    __metadata("design:paramtypes", [User_1.User, Promotion_1.Promotion])
], SavedPromotion);
exports.SavedPromotion = SavedPromotion;
//# sourceMappingURL=SavedPromotion.js.map