import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import contactsRouter from "./contacts";
import sessionsRouter from "./sessions";
import messagesRouter from "./messages";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(contactsRouter);
router.use(sessionsRouter);
router.use(messagesRouter);

export default router;
