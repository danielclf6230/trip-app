import { avatarUrlForDisplay } from "./avatars.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export async function loginHandler(req, res, pool) {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!name || !password || name.length > 80 || password.length > 100) {
    return res.status(400).json({ message: "Invalid credentials" });
  }

  try {
    const [results] = await pool.query("SELECT * FROM trip_users WHERE name = ?", [
      name,
    ]);

    if (!results.length) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = results[0];

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "8h",
      issuer: "trip-tools-api",
      audience: "trip-tools-web",
    });

    res.json({
      id: user.id,
      name: user.name,
      avatarUrl: await avatarUrlForDisplay(user.avatarUrl || null),
      bannerUrl: user.bannerUrl || null,
      role: user.role || "user",
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: "trip-tools-api", audience: "trip-tools-web" });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}
