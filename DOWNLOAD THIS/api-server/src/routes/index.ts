import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import contactsRouter from "./contacts";
import sessionsRouter from "./sessions";
import messagesRouter from "./messages";
import storageRouter from "./storage";
import videocallsRouter from "./videocalls";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(contactsRouter);
router.use(sessionsRouter);
router.use(messagesRouter);
router.use(storageRouter);
router.use(videocallsRouter);

export default router;
