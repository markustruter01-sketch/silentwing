import { Router, type IRouter } from "express";
import healthRouter  from "./health";
import adsbRouter    from "./adsb";
import openskRouter  from "./opensky";
import notamRouter   from "./notam";
import metarRouter   from "./metar";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adsbRouter);
router.use(openskRouter);
router.use(notamRouter);
router.use(metarRouter);

export default router;
