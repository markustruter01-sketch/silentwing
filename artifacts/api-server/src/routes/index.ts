import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adsbRouter   from "./adsb";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adsbRouter);

export default router;
