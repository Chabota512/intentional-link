import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import router from "./routes";
import { verifyToken } from "./lib/auth";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const userId = verifyToken(token);
    if (userId !== null) {
      req.headers["x-user-id"] = String(userId);
      return next();
    }
    if (req.path !== "/users/login" && req.path !== "/users/register" && req.path !== "/healthz") {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
  }
  next();
});

app.use("/api", router);

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error("[API Error]", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

export default app;
