import { NextFunction } from 'express';
import { Request, Response } from 'express';

/**
 * Middleware function to check if the request has correct client header using fireabse-admin auth
 */
export class FirebaseAuth {
  private admin: any;

  constructor(firebaseadmin: any) {
    this.admin = firebaseadmin;
  }

  isAuthorizedForNewUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> => {
    const idToken: string = req.headers.authorization!;

    try {
      const decodedToken = await this.admin.auth().verifyIdToken(idToken);

      if (decodedToken) {
        req.body.idFirebase = decodedToken.uid;
        return next();
      } else {
        return res.status(401).send('You are not authorized');
      }
    } catch (e) {
      return res.status(401).send('You are not authorized!');
    }
  };

  isAuthorizedForProtection = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> => {
    const idToken: string = req.headers.authorization!;

    try {
      const decodedToken = await this.admin.auth().verifyIdToken(idToken);

      if (decodedToken) {
        return next();
      } else {
        return res.status(401).send('You are not authorized');
      }
    } catch (e) {
      return res.status(401).send('You are not authorized!');
    }
  };
}
