import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { z } from "zod";
import bcrypt from "bcrypt";
import crypto from "crypto";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { makePool } from "./db.js";
import { loginHandler, requireAuth } from "./auth.js";
import { mergeTripChanges } from "./trip-merge.js";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters.");
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "2mb" }));

const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://tauri.localhost",
  "https://trip-pepfij0v3-danielclf6230s-projects.vercel.app",
  "https://trip-app-tool.vercel.app",
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

const pool = makePool();

const id = z.string().min(1).max(100);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(""));
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .or(z.literal(""));
const password = z
  .string()
  .min(6)
  .max(100)
  .regex(/[A-Za-z]/)
  .regex(/[0-9]/);
const exchangeCurrency = z.enum([
  "CAD",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "AUD",
  "NZD",
  "CHF",
  "HKD",
  "SGD",
  "KRW",
  "INR",
  "MXN",
  "BRL",
  "AED",
  "THB",
  "PHP",
]);
const exchangeRateCache = new Map();
const EXCHANGE_CACHE_MS = 30 * 60 * 1000;
const TripSchema = z.object({
  tripName: z.string().max(120),
  country: z.string().max(80).default(""),
  city: z.string().max(80).default(""),
  startDate: date,
  endDate: date,
  shoppingCurrency: z
    .enum([
      "CAD",
      "USD",
      "EUR",
      "GBP",
      "JPY",
      "CNY",
      "AUD",
      "NZD",
      "CHF",
      "HKD",
      "SGD",
      "KRW",
      "INR",
      "MXN",
      "BRL",
      "AED",
      "THB",
      "PHP",
    ])
    .optional()
    .default("CAD"),
  shoppingBudget: z.number().min(0).max(1000000000).optional().default(0),
  shopping: z
    .array(
      z.object({
        id,
        text: z.string().max(240),
        checked: z.boolean(),
        price: z.number().min(0).max(1000000000).optional().default(0),
      }),
    )
    .max(500),
  days: z
    .array(
      z.object({
        id,
        date,
        completed: z.boolean(),
        items: z
          .array(
            z.object({
              id,
              place: z.string().max(160),
              time,
              duration: z.string().max(80),
              note: z.string().max(500),
              checked: z.boolean(),
            }),
          )
          .max(500),
      }),
    )
    .max(60),
  travelers: z
    .array(
      z.object({
        id,
        name: z.string().max(80),
        parts: z.number().int().min(1).max(12).optional().default(4),
      }),
    )
    .max(30),
  wheelResults: z
    .record(z.number().int().min(0).max(1000000))
    .optional()
    .default({}),
  notes: z.string().max(20000),
});

const NewTripSchema = z
  .object({
    tripName: z.string().trim().min(2).max(120).optional(),
    country: z.string().trim().min(2).max(80),
    city: z.string().trim().min(2).max(80),
    startDate: date.refine(Boolean),
    endDate: date.refine(Boolean),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "The end date must be on or after the start date.",
    path: ["endDate"],
  });

app.get("/health", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows?.[0]?.ok === 1 });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait and try again." },
});
app.post("/api/auth/login", authLimiter, (req, res) =>
  loginHandler(req, res, pool),
);

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      password,
      inviteCode: z.string().trim().min(8).max(32),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      message:
        "Use your invite code and a password with at least 6 characters, including a letter and a number.",
    });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { name, password, inviteCode } = parsed.data;
    let invitedTrip = null;
    if (inviteCode) {
      const [invites] = await connection.execute(
        "SELECT id, trip_id, created_by FROM trip_tools_invites WHERE code = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE",
        [inviteCode.toUpperCase()],
      );
      if (!invites.length) {
        await connection.rollback();
        return res.status(400).json({
          message: "This invitation is invalid, expired, or already used.",
        });
      }
      invitedTrip = invites[0];
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const [created] = await connection.execute(
      "INSERT INTO trip_users (name, password, invited_by_user_id) VALUES (?, ?, ?)",
      [name, passwordHash, invitedTrip.created_by],
    );
    let tripId;
    tripId = invitedTrip.trip_id;
    await connection.execute(
      "INSERT INTO trip_tools_members (trip_id, user_id, role) VALUES (?, ?, 'member')",
      [tripId, created.insertId],
    );
    await connection.execute(
      "UPDATE trip_tools_invites SET used_by = ?, used_at = NOW() WHERE id = ?",
      [created.insertId, invitedTrip.id],
    );
    await connection.commit();
    req.body = { name, password };
    return loginHandler(req, res, pool);
  } catch (error) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "That traveler name is already registered." });
    console.error("Registration failed:", error);
    return res.status(500).json({ message: "Could not create the account." });
  } finally {
    connection.release();
  }
});

app.patch("/api/auth/password", authLimiter, requireAuth, async (req, res) => {
  const parsed = z
    .object({
      currentPassword: z.string().min(1).max(100),
      newPassword: password,
      confirmPassword: z.string().min(1).max(100),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: "New passwords do not match.",
      path: ["confirmPassword"],
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error:
        "Use matching passwords with at least 6 characters, including a letter and a number.",
    });
  }

  try {
    const [users] = await pool.execute(
      "SELECT password FROM trip_users WHERE id = ?",
      [req.user.id],
    );
    if (
      !users.length ||
      !(await bcrypt.compare(parsed.data.currentPassword, users[0].password))
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "The current password is incorrect." });
    }
    if (await bcrypt.compare(parsed.data.newPassword, users[0].password)) {
      return res.status(400).json({
        ok: false,
        error: "Choose a password different from your current password.",
      });
    }
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await pool.execute("UPDATE trip_users SET password = ? WHERE id = ?", [
      passwordHash,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (error) {
    console.error("Password change failed:", error);
    res
      .status(500)
      .json({ ok: false, error: "Could not update the password." });
  }
});

app.patch("/api/auth/avatar", requireAuth, async (req, res) => {
  const parsed = z
    .object({
      avatarUrl: z
        .string()
        .max(1_800_000)
        .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
        .nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ ok: false, error: "Choose a valid JPG, PNG, or WebP image." });
  try {
    await pool.execute("UPDATE trip_users SET avatarUrl = ? WHERE id = ?", [
      parsed.data.avatarUrl,
      req.user.id,
    ]);
    res.json({ ok: true, avatarUrl: parsed.data.avatarUrl });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/exchange-rate", requireAuth, async (req, res) => {
  const parsed = z
    .object({ from: exchangeCurrency, to: exchangeCurrency })
    .safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({
      ok: false,
      error: "Choose two supported currencies.",
    });

  const { from, to } = parsed.data;
  if (from === to) {
    return res.json({
      ok: true,
      base: from,
      quote: to,
      rate: 1,
      date: new Date().toISOString().slice(0, 10),
      source: "Identity rate",
    });
  }

  const cacheKey = `${from}/${to}`;
  const cached = exchangeRateCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < EXCHANGE_CACHE_MS)
    return res.json({ ok: true, ...cached.data, cached: true });

  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v2/rate/${from}/${to}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok)
      throw new Error(`Rate provider returned ${response.status}.`);
    const payload = await response.json();
    const rate = Number(payload.rate);
    if (!Number.isFinite(rate) || rate <= 0)
      throw new Error("Rate provider returned an invalid rate.");

    const data = {
      base: from,
      quote: to,
      rate,
      date: payload.date,
      source: "Frankfurter",
    };
    exchangeRateCache.set(cacheKey, { data, fetchedAt: Date.now() });
    res.json({ ok: true, ...data, cached: false });
  } catch (error) {
    console.error("Exchange rate request failed:", error);
    res.status(502).json({
      ok: false,
      error:
        "The latest exchange rate is temporarily unavailable. Please try again.",
    });
  }
});

app.use("/api/admin", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT role FROM trip_users WHERE id = ?",
      [req.user.id],
    );
    if (rows[0]?.role !== "admin")
      return res
        .status(403)
        .json({ ok: false, error: "Administrator access required." });
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/users", async (_req, res) => {
  const [users] = await pool.query(`
    SELECT u.id, u.name, u.role, u.created_at, COUNT(m.trip_id) AS trip_count
    FROM trip_users u LEFT JOIN trip_tools_members m ON m.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at, u.id
  `);
  res.json({ ok: true, users });
});

app.get("/api/admin/overview", async (_req, res) => {
  const [users] = await pool.query(`
    SELECT u.id, u.name, u.role, u.created_at, m.trip_id, m.role AS membership_role
    FROM trip_users u LEFT JOIN trip_tools_members m ON m.user_id = u.id
    ORDER BY u.created_at, u.id
  `);
  const [groups] = await pool.query(`
    SELECT t.id, t.owner_user_id,
      COALESCE(
        JSON_UNQUOTE(JSON_EXTRACT(active_profile.trip_data, '$.tripName')),
        JSON_UNQUOTE(JSON_EXTRACT(latest_profile.trip_data, '$.tripName')),
        JSON_UNQUOTE(JSON_EXTRACT(t.trip_data, '$.tripName')),
        CONCAT('Group #', t.id)
      ) AS name,
      t.updated_at
    FROM trip_tools_trips t
    LEFT JOIN trip_tools_active_profiles active ON active.user_id = t.owner_user_id
    LEFT JOIN trip_tools_trip_profiles active_profile
      ON active_profile.id = active.profile_id AND active_profile.group_id = t.id
    LEFT JOIN trip_tools_trip_profiles latest_profile ON latest_profile.id = (
      SELECT p.id FROM trip_tools_trip_profiles p
      WHERE p.group_id = t.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1
    )
    ORDER BY t.created_at, t.id
  `);
  res.json({
    ok: true,
    users,
    groups: groups.map((group) => ({
      ...group,
      members: users
        .filter((user) => user.trip_id === group.id)
        .map((user) => ({
          id: user.id,
          name: user.name,
          role: user.membership_role,
        })),
    })),
  });
});

app.post("/api/admin/users", async (req, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      password,
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      ok: false,
      error:
        "Password must have at least 6 characters, including a letter and a number.",
    });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const [created] = await connection.execute(
      "INSERT INTO trip_users (name, password, role) VALUES (?, ?, 'user')",
      [parsed.data.name, hash],
    );
    const data = JSON.stringify({
      tripName: `${parsed.data.name}'s Trip`,
      country: "",
      city: "",
      startDate: "",
      endDate: "",
      shoppingCurrency: "CAD",
      shoppingBudget: 0,
      shopping: [],
      days: [],
      travelers: [],
      wheelResults: {},
      notes: "",
    });
    const [trip] = await connection.execute(
      "INSERT INTO trip_tools_trips (owner_user_id, trip_data) VALUES (?, ?)",
      [created.insertId, data],
    );
    await connection.execute(
      "INSERT INTO trip_tools_members (trip_id, user_id, role) VALUES (?, ?, 'owner')",
      [trip.insertId, created.insertId],
    );
    await connection.commit();
    res.status(201).json({ ok: true, id: created.insertId });
  } catch (error) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ ok: false, error: "That traveler name already exists." });
    throw error;
  } finally {
    connection.release();
  }
});

app.patch("/api/admin/users/:id/password", async (req, res) => {
  const parsed = z
    .object({
      password,
    })
    .safeParse(req.body);
  const userId = Number(req.params.id);
  if (!parsed.success || !Number.isSafeInteger(userId) || userId < 1)
    return res
      .status(400)
      .json({
        ok: false,
        error: "Use at least 6 characters with a letter and a number.",
      });
  const hash = await bcrypt.hash(parsed.data.password, 12);
  const [result] = await pool.execute(
    "UPDATE trip_users SET password = ? WHERE id = ?",
    [hash, userId],
  );
  if (!result.affectedRows)
    return res.status(404).json({ ok: false, error: "User not found." });
  res.json({ ok: true });
});

app.patch("/api/admin/users/:id/group", async (req, res) => {
  res.status(410).json({
    ok: false,
    error:
      "Moving a traveler was replaced by adding or removing individual trip memberships.",
  });
});

app.delete("/api/admin/users/:id", async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId < 1)
    return res.status(400).json({ ok: false, error: "Invalid user." });
  if (userId === req.user.id)
    return res.status(400).json({
      ok: false,
      error: "You cannot delete your own administrator account.",
    });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute(
      "SELECT id FROM trip_users WHERE id = ? FOR UPDATE",
      [userId],
    );
    if (!users.length) {
      await connection.rollback();
      return res.status(404).json({ ok: false, error: "User not found." });
    }
    // Owned trips cannot remain without their owner. Deleting them first also
    // removes their memberships, invites, and active-trip records via cascades.
    await connection.execute(
      "DELETE FROM trip_tools_trips WHERE owner_user_id = ?",
      [userId],
    );
    await connection.execute("DELETE FROM trip_users WHERE id = ?", [userId]);
    await connection.commit();
    res.json({ ok: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

app.use("/api/manage", requireAuth);

async function managementAccess(userId, tripId) {
  const [rows] = await pool.execute(
    `SELECT u.role,
      EXISTS(
        SELECT 1 FROM trip_tools_members m
        WHERE m.user_id = u.id AND m.trip_id = ? AND m.role = 'owner'
      ) AS owns_trip
     FROM trip_users u WHERE u.id = ?`,
    [tripId, userId],
  );
  return rows[0]?.role === "admin" || Boolean(rows[0]?.owns_trip);
}

app.get("/api/manage/overview", async (req, res) => {
  try {
    const [managers] = await pool.execute(
      "SELECT role FROM trip_users WHERE id = ?",
      [req.user.id],
    );
    const isAdmin = managers[0]?.role === "admin";
    const [groups] = await pool.execute(
      `SELECT DISTINCT t.id, t.owner_user_id,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.trip_data, '$.tripName')), CONCAT('Trip #', t.id)) AS name,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.trip_data, '$.city')), '') AS city,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.trip_data, '$.country')), '') AS country,
        t.updated_at
       FROM trip_tools_trips t
       LEFT JOIN trip_tools_members manager_membership
         ON manager_membership.trip_id = t.id AND manager_membership.user_id = ?
       WHERE ? OR manager_membership.role = 'owner'
       ORDER BY t.created_at, t.id`,
      [req.user.id, isAdmin],
    );
    const groupIds = groups.map((group) => group.id);
    let memberships = [];
    let users = [];
    if (groupIds.length) {
      const placeholders = groupIds.map(() => "?").join(",");
      [memberships] = await pool.query(
        `SELECT m.trip_id, m.user_id, m.role, u.name
         FROM trip_tools_members m JOIN trip_users u ON u.id = m.user_id
         WHERE m.trip_id IN (${placeholders}) ORDER BY m.joined_at, u.id`,
        groupIds,
      );
      if (isAdmin) {
        [users] = await pool.query(
          `SELECT u.id, u.name, u.role, u.created_at,
            COUNT(m.trip_id) AS group_count,
            COALESCE(SUM(m.role = 'owner'), 0) AS owned_group_count,
            COALESCE(u.invited_by_user_id, (SELECT i.created_by FROM trip_tools_invites i
             WHERE i.used_by = u.id AND i.used_at IS NOT NULL
             ORDER BY i.used_at DESC, i.id DESC LIMIT 1)) AS invited_by_user_id
           FROM trip_users u LEFT JOIN trip_tools_members m ON m.user_id = u.id
           GROUP BY u.id ORDER BY u.created_at, u.id`,
        );
      } else {
        [users] = await pool.query(
          `SELECT u.id, u.name, u.role, u.created_at,
            COUNT(DISTINCT all_memberships.trip_id) AS group_count,
            COALESCE(SUM(all_memberships.role = 'owner'), 0) AS owned_group_count,
            COALESCE(u.invited_by_user_id, (SELECT i.created_by FROM trip_tools_invites i
             WHERE i.used_by = u.id AND i.used_at IS NOT NULL
             ORDER BY i.used_at DESC, i.id DESC LIMIT 1)) AS invited_by_user_id
           FROM trip_users u
           LEFT JOIN trip_tools_members all_memberships ON all_memberships.user_id = u.id
           WHERE EXISTS (
             SELECT 1 FROM trip_tools_members owner_membership
             WHERE owner_membership.user_id = u.id AND owner_membership.role = 'owner'
           ) OR EXISTS (
             SELECT 1 FROM trip_tools_members visible_membership
             WHERE visible_membership.user_id = u.id
               AND visible_membership.trip_id IN (${placeholders})
           )
           GROUP BY u.id ORDER BY u.created_at, u.id`,
          groupIds,
        );
      }
    }
    res.json({
      ok: true,
      isAdmin,
      users,
      groups: groups.map((group) => ({
        ...group,
        members: memberships
          .filter((membership) => membership.trip_id === group.id)
          .map((membership) => ({
            id: membership.user_id,
            name: membership.name,
            role: membership.role,
          })),
      })),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/manage/groups/:tripId/users/:userId", async (req, res) => {
  const tripId = Number(req.params.tripId);
  const userId = Number(req.params.userId);
  if (
    ![tripId, userId].every((value) => Number.isSafeInteger(value) && value > 0)
  )
    return res
      .status(400)
      .json({ ok: false, error: "Choose a valid user and trip." });
  try {
    if (!(await managementAccess(req.user.id, tripId)))
      return res
        .status(403)
        .json({ ok: false, error: "You can only manage trips you own." });
    const [[manager]] = await pool.execute(
      "SELECT role FROM trip_users WHERE id = ?",
      [req.user.id],
    );
    if (manager.role !== "admin") {
      const [visible] = await pool.execute(
        `SELECT 1 FROM trip_tools_members candidate
         LEFT JOIN trip_tools_members owned
           ON owned.trip_id = candidate.trip_id AND owned.user_id = ? AND owned.role = 'owner'
         WHERE candidate.user_id = ? AND (candidate.role = 'owner' OR owned.user_id IS NOT NULL)
         LIMIT 1`,
        [req.user.id, userId],
      );
      if (!visible.length)
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "You can add another owner or one of your invited travelers.",
          });
    }
    const [users] = await pool.execute(
      "SELECT id FROM trip_users WHERE id = ?",
      [userId],
    );
    if (!users.length)
      return res.status(404).json({ ok: false, error: "User not found." });
    await pool.execute(
      "INSERT IGNORE INTO trip_tools_members (trip_id, user_id, role) VALUES (?, ?, 'member')",
      [tripId, userId],
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/manage/groups/:tripId/users/:userId", async (req, res) => {
  const tripId = Number(req.params.tripId);
  const userId = Number(req.params.userId);
  if (
    ![tripId, userId].every((value) => Number.isSafeInteger(value) && value > 0)
  )
    return res
      .status(400)
      .json({ ok: false, error: "Choose a valid user and trip." });
  try {
    if (!(await managementAccess(req.user.id, tripId)))
      return res
        .status(403)
        .json({ ok: false, error: "You can only manage trips you own." });
    const [memberships] = await pool.execute(
      "SELECT role FROM trip_tools_members WHERE trip_id = ? AND user_id = ?",
      [tripId, userId],
    );
    if (!memberships.length)
      return res
        .status(404)
        .json({ ok: false, error: "That traveler is not in this trip." });
    if (memberships[0].role === "owner")
      return res
        .status(400)
        .json({
          ok: false,
          error: "An owner cannot be removed from their own trip.",
        });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "DELETE FROM trip_tools_members WHERE trip_id = ? AND user_id = ?",
        [tripId, userId],
      );
      await connection.execute(
        "DELETE FROM trip_tools_active_trips WHERE user_id = ? AND trip_id = ?",
        [userId, tripId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use("/api/trip", requireAuth);
app.use("/api/trips", requireAuth);

async function getTripAccess(userId, tripId) {
  const [rows] = await pool.execute(
    `SELECT t.id AS trip_id, t.trip_data, t.updated_at, m.role
     FROM trip_tools_members m
     JOIN trip_tools_trips t ON t.id = m.trip_id
     WHERE m.user_id = ? AND t.id = ? LIMIT 1`,
    [userId, tripId],
  );
  return rows[0] ?? null;
}

async function hasOwnerPrivileges(userId) {
  const [rows] = await pool.execute(
    `SELECT u.role,
      EXISTS(
        SELECT 1 FROM trip_tools_members m
        WHERE m.user_id = u.id AND m.role = 'owner'
      ) AS owns_trip
     FROM trip_users u WHERE u.id = ?`,
    [userId],
  );
  return rows[0]?.role === "admin" || Boolean(rows[0]?.owns_trip);
}

function tripDays(startDate, endDate) {
  const days = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const last = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= last && days.length < 60) {
    const day = cursor.toISOString().slice(0, 10);
    days.push({
      id: crypto.randomUUID(),
      date: day,
      completed: false,
      items: [
        {
          id: crypto.randomUUID(),
          place: "",
          time: "",
          duration: "",
          note: "",
          checked: false,
        },
      ],
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

app.get("/api/trips", async (req, res) => {
  try {
    const [profiles] = await pool.execute(
      `SELECT t.id, t.trip_data, t.created_at, t.updated_at, m.role
       FROM trip_tools_members m
       JOIN trip_tools_trips t ON t.id = m.trip_id
       WHERE m.user_id = ? ORDER BY t.created_at DESC, t.id DESC`,
      [req.user.id],
    );
    const [activeProfiles] = await pool.execute(
      `SELECT active.trip_id
       FROM trip_tools_active_trips active
       JOIN trip_tools_members member
         ON member.trip_id = active.trip_id AND member.user_id = active.user_id
       WHERE active.user_id = ?`,
      [req.user.id],
    );
    const [permissions] = await pool.execute(
      `SELECT u.role,
        EXISTS(SELECT 1 FROM trip_tools_members m WHERE m.user_id = u.id AND m.role = 'owner') AS owns_trip
       FROM trip_users u WHERE u.id = ?`,
      [req.user.id],
    );
    const canManage =
      permissions[0]?.role === "admin" || Boolean(permissions[0]?.owns_trip);
    res.json({
      ok: true,
      canCreate: canManage,
      canManage,
      activeTripId: activeProfiles[0]?.trip_id ?? null,
      trips: profiles.map((profile) => {
        const data =
          typeof profile.trip_data === "string"
            ? JSON.parse(profile.trip_data)
            : profile.trip_data;
        return {
          id: profile.id,
          tripName: data.tripName || "Untitled trip",
          country: data.country || "",
          city: data.city || "",
          startDate: data.startDate || "",
          endDate: data.endDate || "",
          role: profile.role,
          createdAt: profile.created_at,
          updatedAt: profile.updated_at,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/trips/:tripId", async (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!Number.isSafeInteger(tripId) || tripId < 1)
    return res.status(400).json({ ok: false, error: "Choose a valid trip." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [trips] = await connection.execute(
      `SELECT t.id, t.owner_user_id, u.role
       FROM trip_tools_trips t
       JOIN trip_users u ON u.id = ?
       WHERE t.id = ? FOR UPDATE`,
      [req.user.id, tripId],
    );
    if (!trips.length) {
      await connection.rollback();
      return res.status(404).json({ ok: false, error: "Trip not found." });
    }
    const trip = trips[0];
    if (
      trip.role !== "admin" &&
      Number(trip.owner_user_id) !== Number(req.user.id)
    ) {
      await connection.rollback();
      return res
        .status(403)
        .json({
          ok: false,
          error:
            "Only the trip owner or an administrator can delete this trip.",
        });
    }
    await connection.execute("DELETE FROM trip_tools_trips WHERE id = ?", [
      tripId,
    ]);
    await connection.commit();
    res.json({ ok: true });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ ok: false, error: "Could not delete the trip." });
  } finally {
    connection.release();
  }
});

app.patch("/api/trips/active", async (req, res) => {
  const parsed = z
    .object({ tripId: z.number().int().positive().nullable() })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ ok: false, error: "Choose a valid trip." });
  try {
    if (parsed.data.tripId === null) {
      await pool.execute(
        "DELETE FROM trip_tools_active_trips WHERE user_id = ?",
        [req.user.id],
      );
      return res.json({ ok: true, activeTripId: null });
    }
    const access = await getTripAccess(req.user.id, parsed.data.tripId);
    if (!access)
      return res
        .status(404)
        .json({ ok: false, error: "Trip not found in your group." });
    await pool.execute(
      `INSERT INTO trip_tools_active_trips (user_id, trip_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE trip_id = VALUES(trip_id)`,
      [req.user.id, parsed.data.tripId],
    );
    res.json({ ok: true, activeTripId: parsed.data.tripId });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/trips", async (req, res) => {
  const parsed = NewTripSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  try {
    const [permissions] = await pool.execute(
      `SELECT u.role,
        EXISTS(SELECT 1 FROM trip_tools_members m WHERE m.user_id = u.id AND m.role = 'owner') AS owns_trip
       FROM trip_users u WHERE u.id = ?`,
      [req.user.id],
    );
    if (permissions[0]?.role !== "admin" && !permissions[0]?.owns_trip)
      return res
        .status(403)
        .json({ ok: false, error: "Only group owners can create trips." });
    const values = parsed.data;
    const trip = {
      tripName: values.tripName || `${values.city} Adventure`,
      country: values.country,
      city: values.city,
      startDate: values.startDate,
      endDate: values.endDate,
      shoppingCurrency: "CAD",
      shoppingBudget: 0,
      shopping: [],
      days: tripDays(values.startDate, values.endDate),
      travelers: [],
      wheelResults: {},
      notes: "",
    };
    const connection = await pool.getConnection();
    let created;
    try {
      await connection.beginTransaction();
      [created] = await connection.execute(
        "INSERT INTO trip_tools_trips (owner_user_id, trip_data) VALUES (?, ?)",
        [req.user.id, JSON.stringify(trip)],
      );
      await connection.execute(
        "INSERT INTO trip_tools_members (trip_id, user_id, role) VALUES (?, ?, 'owner')",
        [created.insertId, req.user.id],
      );
      await connection.execute(
        `INSERT INTO trip_tools_active_trips (user_id, trip_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE trip_id = VALUES(trip_id)`,
        [req.user.id, created.insertId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.status(201).json({ ok: true, id: created.insertId, trip });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/trip", async (req, res) => {
  try {
    const profileId = req.query.tripId ? Number(req.query.tripId) : null;
    if (req.query.tripId && (!Number.isSafeInteger(profileId) || profileId < 1))
      return res.status(400).json({ ok: false, error: "Invalid trip." });
    const membership = await getTripAccess(req.user.id, profileId);
    if (!membership)
      return res
        .status(404)
        .json({ ok: false, error: "No trip is connected to this account." });
    const ownerPrivileges = await hasOwnerPrivileges(req.user.id);
    res.json({
      ok: true,
      id: membership.trip_id,
      trip: membership.trip_data,
      role: membership.role,
      canInvite: ownerPrivileges,
      updatedAt: membership.updated_at,
    });
  } catch (error) {
    console.error("Load trip failed:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/trip", async (req, res) => {
  const parsed = TripSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  try {
    const profileId = Number(req.query.tripId);
    if (!Number.isSafeInteger(profileId) || profileId < 1)
      return res.status(400).json({ ok: false, error: "Choose a valid trip." });
    const membership = await getTripAccess(req.user.id, profileId);
    if (!membership)
      return res
        .status(404)
        .json({ ok: false, error: "No trip is connected to this account." });
    await pool.execute(
      "UPDATE trip_tools_trips SET trip_data = ? WHERE id = ?",
      [JSON.stringify(parsed.data), membership.trip_id],
    );
    res.json({ ok: true });
  } catch (error) {
    console.error("Save trip failed:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch("/api/trip", async (req, res) => {
  const parsed = z
    .object({ base: TripSchema, trip: TripSchema })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const tripId = Number(req.query.tripId);
  if (!Number.isSafeInteger(tripId) || tripId < 1)
    return res.status(400).json({ ok: false, error: "Choose a valid trip." });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [memberships] = await connection.execute(
      `SELECT t.id AS trip_id, t.trip_data
       FROM trip_tools_members m
       JOIN trip_tools_trips t ON t.id = m.trip_id
       WHERE m.user_id = ? AND t.id = ?
       LIMIT 1 FOR UPDATE`,
      [req.user.id, tripId],
    );
    if (!memberships.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ ok: false, error: "No trip is connected to this account." });
    }

    const stored =
      typeof memberships[0].trip_data === "string"
        ? JSON.parse(memberships[0].trip_data)
        : memberships[0].trip_data;
    const merged = mergeTripChanges(parsed.data.base, parsed.data.trip, stored);
    const validated = TripSchema.safeParse(merged);
    if (!validated.success) {
      await connection.rollback();
      return res.status(409).json({
        ok: false,
        error:
          "The simultaneous changes could not be merged safely. Reload and try again.",
      });
    }

    await connection.execute(
      "UPDATE trip_tools_trips SET trip_data = ? WHERE id = ?",
      [JSON.stringify(validated.data), memberships[0].trip_id],
    );
    await connection.commit();
    res.json({ ok: true, trip: validated.data });
  } catch (error) {
    await connection.rollback();
    console.error("Merge trip changes failed:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    connection.release();
  }
});

app.get("/api/trip/members", async (req, res) => {
  try {
    const tripId = Number(req.query.tripId);
    if (!Number.isSafeInteger(tripId) || tripId < 1)
      return res.status(400).json({ ok: false, error: "Choose a valid trip." });
    const membership = await getTripAccess(req.user.id, tripId);
    if (!membership)
      return res
        .status(404)
        .json({ ok: false, error: "No shared trip found." });
    const [members] = await pool.execute(
      `SELECT u.id, u.name, u.avatarUrl, m.role FROM trip_tools_members m
       JOIN trip_users u ON u.id = m.user_id WHERE m.trip_id = ? ORDER BY m.joined_at`,
      [membership.trip_id],
    );
    res.json({ ok: true, members });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/trip/invites", async (req, res) => {
  try {
    const tripId = Number(req.body?.tripId);
    if (!Number.isSafeInteger(tripId) || tripId < 1)
      return res.status(400).json({ ok: false, error: "Choose a valid trip." });
    const membership = await getTripAccess(req.user.id, tripId);
    if (!membership)
      return res
        .status(404)
        .json({ ok: false, error: "No shared trip found." });
    if (!(await hasOwnerPrivileges(req.user.id)))
      return res.status(403).json({
        ok: false,
        error: "Only trip owners can invite new members.",
      });
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    await pool.execute(
      "INSERT INTO trip_tools_invites (trip_id, code, created_by, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))",
      [membership.trip_id, code, req.user.id],
    );
    res.json({ ok: true, code, expiresInDays: 7 });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use((err, _req, res, _next) => {
  if (err?.message === "Not allowed by CORS")
    return res.status(403).json({ ok: false, error: err.message });
  console.error(err);
  res.status(500).json({ ok: false, error: "Server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Trip Tools API running on ${PORT}`));
