import dotenv from "dotenv";
dotenv.config();
import { makePool } from "./db.js";

const pool = makePool();
const initialTrip = JSON.stringify({
  tripName: "Our Tokyo Adventure", country: "Japan", city: "Tokyo", startDate: "", endDate: "", shoppingBudget: 0, shopping: [],
  days: [], travelers: [], notes: "",
});

try {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingUsers] = await connection.query("SHOW TABLES LIKE 'trip_users'");
    if (!existingUsers.length) {
      await connection.query(`CREATE TABLE trip_users (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL, avatarUrl MEDIUMTEXT NULL, bannerUrl MEDIUMTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    }
    const [roleColumns] = await connection.query("SHOW COLUMNS FROM trip_users LIKE 'role'");
    if (!roleColumns.length) await connection.query("ALTER TABLE trip_users ADD COLUMN role ENUM('admin', 'user') NOT NULL DEFAULT 'user' AFTER password");
    const [invitedByColumns] = await connection.query("SHOW COLUMNS FROM trip_users LIKE 'invited_by_user_id'");
    if (!invitedByColumns.length) {
      await connection.query(`ALTER TABLE trip_users
        ADD COLUMN invited_by_user_id INT NULL AFTER role,
        ADD INDEX idx_trip_user_inviter (invited_by_user_id),
        ADD CONSTRAINT fk_trip_user_inviter FOREIGN KEY (invited_by_user_id) REFERENCES trip_users(id) ON DELETE SET NULL`);
    }
    const [avatarMigrations] = await connection.query("SHOW COLUMNS FROM trip_users LIKE 'avatarUrl'");
    if (avatarMigrations.length && !/text/i.test(avatarMigrations[0].Type)) {
      await connection.query("ALTER TABLE trip_users MODIFY COLUMN avatarUrl MEDIUMTEXT NULL");
    }
    await connection.execute("UPDATE trip_users SET name = 'daniel.chow', role = 'admin' WHERE name = 'daniel'");
    await connection.execute("UPDATE trip_users SET role = 'admin' WHERE name = 'daniel.chow'");
    await connection.query(`CREATE TABLE IF NOT EXISTS trip_tools_trips (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_user_id INT NOT NULL,
      trip_data JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_trip_owner FOREIGN KEY (owner_user_id) REFERENCES trip_users(id) ON DELETE RESTRICT
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS trip_tools_members (
      trip_id INT NOT NULL,
      user_id INT NOT NULL,
      role ENUM('owner', 'member') NOT NULL DEFAULT 'member',
      joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (trip_id, user_id),
      CONSTRAINT fk_member_trip FOREIGN KEY (trip_id) REFERENCES trip_tools_trips(id) ON DELETE CASCADE,
      CONSTRAINT fk_member_user FOREIGN KEY (user_id) REFERENCES trip_users(id) ON DELETE CASCADE
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS trip_tools_trip_profiles (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      trip_data JSON NOT NULL,
      created_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_trip_profile_group (group_id),
      CONSTRAINT fk_trip_profile_group FOREIGN KEY (group_id) REFERENCES trip_tools_trips(id) ON DELETE CASCADE,
      CONSTRAINT fk_trip_profile_creator FOREIGN KEY (created_by) REFERENCES trip_users(id) ON DELETE SET NULL
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS trip_tools_active_profiles (
      user_id INT NOT NULL PRIMARY KEY,
      profile_id INT NOT NULL,
      selected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_active_profile_user FOREIGN KEY (user_id) REFERENCES trip_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_active_profile_trip FOREIGN KEY (profile_id) REFERENCES trip_tools_trip_profiles(id) ON DELETE CASCADE
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS trip_tools_active_trips (
      user_id INT NOT NULL PRIMARY KEY,
      trip_id INT NOT NULL,
      selected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_active_trip_user FOREIGN KEY (user_id) REFERENCES trip_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_active_trip_trip FOREIGN KEY (trip_id) REFERENCES trip_tools_trips(id) ON DELETE CASCADE
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS trip_tools_profile_group_map (
      profile_id INT NOT NULL PRIMARY KEY,
      trip_id INT NOT NULL UNIQUE,
      CONSTRAINT fk_profile_map_profile FOREIGN KEY (profile_id) REFERENCES trip_tools_trip_profiles(id) ON DELETE CASCADE,
      CONSTRAINT fk_profile_map_trip FOREIGN KEY (trip_id) REFERENCES trip_tools_trips(id) ON DELETE CASCADE
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS trip_tools_invites (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      trip_id INT NOT NULL,
      code VARCHAR(32) NOT NULL UNIQUE,
      created_by INT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_by INT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_invite_trip FOREIGN KEY (trip_id) REFERENCES trip_tools_trips(id) ON DELETE CASCADE,
      CONSTRAINT fk_invite_creator FOREIGN KEY (created_by) REFERENCES trip_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_invite_user FOREIGN KEY (used_by) REFERENCES trip_users(id) ON DELETE SET NULL
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS trip_tools_migrations (
      migration_key VARCHAR(100) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    const [memberIndexes] = await connection.query("SHOW INDEX FROM trip_tools_members WHERE Key_name = 'uq_trip_member_user'");
    const [manyGroupsAlreadyApplied] = await connection.execute(
      "SELECT migration_key FROM trip_tools_migrations WHERE migration_key = 'one_group_per_trip_v7'",
    );
    if (!memberIndexes.length && !manyGroupsAlreadyApplied.length) {
      await connection.query("ALTER TABLE trip_tools_members ADD UNIQUE KEY uq_trip_member_user (user_id)");
    }

    const [members] = await connection.query("SELECT COUNT(*) AS count FROM trip_tools_members");
    if (!Number(members[0].count)) {
      const [users] = await connection.query("SELECT id FROM trip_users ORDER BY id");
      if (users.length) {
        const [trip] = await connection.execute("INSERT INTO trip_tools_trips (owner_user_id, trip_data) VALUES (?, ?)", [users[0].id, initialTrip]);
        for (const [index, user] of users.entries()) {
          await connection.execute("INSERT INTO trip_tools_members (trip_id, user_id, role) VALUES (?, ?, ?)", [trip.insertId, user.id, index === 0 ? "owner" : "member"]);
        }
      }
    }

    const [groupMigration] = await connection.execute("SELECT migration_key FROM trip_tools_migrations WHERE migration_key = 'separate_admin_created_users_v3'");
    if (!groupMigration.length) {
      const [standaloneUsers] = await connection.query(`
        SELECT DISTINCT u.id, u.name
        FROM trip_users u
        JOIN trip_tools_members m ON m.user_id = u.id
        JOIN trip_tools_trips t ON t.id = m.trip_id
        JOIN trip_users owner ON owner.id = t.owner_user_id
        WHERE u.role = 'user' AND owner.role = 'admin' AND t.owner_user_id <> u.id
      `);
      for (const user of standaloneUsers) {
        const data = JSON.stringify({ tripName: `${user.name}'s Trip`, country: "", city: "", startDate: "", endDate: "", shoppingBudget: 0, shopping: [], days: [], travelers: [], notes: "" });
        await connection.execute("DELETE FROM trip_tools_members WHERE user_id = ?", [user.id]);
        const [newTrip] = await connection.execute("INSERT INTO trip_tools_trips (owner_user_id, trip_data) VALUES (?, ?)", [user.id, data]);
        await connection.execute("INSERT INTO trip_tools_members (trip_id, user_id, role) VALUES (?, ?, 'owner')", [newTrip.insertId, user.id]);
      }
      await connection.execute("INSERT INTO trip_tools_migrations (migration_key) VALUES ('separate_admin_created_users_v3')");
    }

    const [multiOwnerMigration] = await connection.execute(
      "SELECT migration_key FROM trip_tools_migrations WHERE migration_key = 'preserve_admin_created_owners_v4'",
    );
    if (!multiOwnerMigration.length) {
      await connection.query(`
        UPDATE trip_tools_members m
        JOIN trip_users u ON u.id = m.user_id
        LEFT JOIN trip_tools_invites i ON i.used_by = u.id
        SET m.role = 'owner'
        WHERE u.role = 'admin' OR i.id IS NULL
      `);
      await connection.execute(
        "INSERT INTO trip_tools_migrations (migration_key) VALUES ('preserve_admin_created_owners_v4')",
      );
    }

    const [tripProfilesMigration] = await connection.execute(
      "SELECT migration_key FROM trip_tools_migrations WHERE migration_key = 'create_trip_profiles_v5'",
    );
    if (!tripProfilesMigration.length) {
      const [legacyTrips] = await connection.query(`
        SELECT t.id, t.owner_user_id, t.trip_data
        FROM trip_tools_trips t
        LEFT JOIN trip_tools_trip_profiles p ON p.group_id = t.id
        WHERE p.id IS NULL
      `);
      for (const legacyTrip of legacyTrips) {
        const tripData = typeof legacyTrip.trip_data === "string"
          ? JSON.parse(legacyTrip.trip_data)
          : legacyTrip.trip_data;
        if (!Object.hasOwn(tripData, "country")) tripData.country = "Japan";
        if (!Object.hasOwn(tripData, "city")) tripData.city = "Tokyo";
        await connection.execute(
          "INSERT INTO trip_tools_trip_profiles (group_id, trip_data, created_by) VALUES (?, ?, ?)",
          [legacyTrip.id, JSON.stringify(tripData), legacyTrip.owner_user_id],
        );
      }
      await connection.execute(
        "INSERT INTO trip_tools_migrations (migration_key) VALUES ('create_trip_profiles_v5')",
      );
    }

    const [activeProfilesMigration] = await connection.execute(
      "SELECT migration_key FROM trip_tools_migrations WHERE migration_key = 'remember_active_trip_v6'",
    );
    if (!activeProfilesMigration.length) {
      await connection.query(`
        INSERT INTO trip_tools_active_profiles (user_id, profile_id)
        SELECT m.user_id, MAX(p.id)
        FROM trip_tools_members m
        JOIN trip_tools_trip_profiles p ON p.group_id = m.trip_id
        GROUP BY m.user_id
        ON DUPLICATE KEY UPDATE profile_id = VALUES(profile_id)
      `);
      await connection.execute(
        "INSERT INTO trip_tools_migrations (migration_key) VALUES ('remember_active_trip_v6')",
      );
    }

    const [manyGroupsMigration] = await connection.execute(
      "SELECT migration_key FROM trip_tools_migrations WHERE migration_key = 'one_group_per_trip_v7'",
    );
    if (!manyGroupsMigration.length) {
      const [uniqueMembershipIndexes] = await connection.query(
        "SHOW INDEX FROM trip_tools_members WHERE Key_name = 'uq_trip_member_user'",
      );
      if (uniqueMembershipIndexes.length) {
        const [memberUserIndexes] = await connection.query(
          "SHOW INDEX FROM trip_tools_members WHERE Key_name = 'idx_trip_member_user'",
        );
        if (!memberUserIndexes.length) {
          await connection.query(
            "ALTER TABLE trip_tools_members ADD INDEX idx_trip_member_user (user_id)",
          );
        }
        await connection.query("ALTER TABLE trip_tools_members DROP INDEX uq_trip_member_user");
      }

      const [legacyGroups] = await connection.query(
        "SELECT id, owner_user_id FROM trip_tools_trips ORDER BY id",
      );
      for (const group of legacyGroups) {
        const [profiles] = await connection.execute(
          `SELECT id, trip_data FROM trip_tools_trip_profiles
           WHERE group_id = ? ORDER BY created_at, id`,
          [group.id],
        );
        if (!profiles.length) continue;
        const [memberships] = await connection.execute(
          "SELECT user_id, role FROM trip_tools_members WHERE trip_id = ? ORDER BY joined_at",
          [group.id],
        );
        for (const [index, profile] of profiles.entries()) {
          const profileData = typeof profile.trip_data === "string"
            ? profile.trip_data
            : JSON.stringify(profile.trip_data);
          let tripId = group.id;
          if (index === 0) {
            await connection.execute(
              "UPDATE trip_tools_trips SET trip_data = ? WHERE id = ?",
              [profileData, tripId],
            );
          } else {
            const [createdTrip] = await connection.execute(
              "INSERT INTO trip_tools_trips (owner_user_id, trip_data) VALUES (?, ?)",
              [group.owner_user_id, profileData],
            );
            tripId = createdTrip.insertId;
            for (const membership of memberships) {
              await connection.execute(
                "INSERT IGNORE INTO trip_tools_members (trip_id, user_id, role) VALUES (?, ?, ?)",
                [tripId, membership.user_id, membership.role],
              );
            }
          }
          await connection.execute(
            "INSERT INTO trip_tools_profile_group_map (profile_id, trip_id) VALUES (?, ?)",
            [profile.id, tripId],
          );
        }
      }

      await connection.query(`
        INSERT INTO trip_tools_active_trips (user_id, trip_id)
        SELECT active.user_id, mapped.trip_id
        FROM trip_tools_active_profiles active
        JOIN trip_tools_profile_group_map mapped ON mapped.profile_id = active.profile_id
        ON DUPLICATE KEY UPDATE trip_id = VALUES(trip_id)
      `);
      await connection.execute(
        "INSERT INTO trip_tools_migrations (migration_key) VALUES ('one_group_per_trip_v7')",
      );
    }
  await connection.query(`CREATE TABLE IF NOT EXISTS trip_tools_photos (
    id CHAR(36) PRIMARY KEY, trip_id INT NOT NULL, uploaded_by INT NULL,
    s3_key VARCHAR(512) NOT NULL, url VARCHAR(1024) NOT NULL,
    content_type VARCHAR(40) NOT NULL, size_bytes INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_photo_trip (trip_id),
    CONSTRAINT fk_photo_trip FOREIGN KEY (trip_id) REFERENCES trip_tools_trips(id) ON DELETE CASCADE,
    CONSTRAINT fk_photo_user FOREIGN KEY (uploaded_by) REFERENCES trip_users(id) ON DELETE SET NULL
  )`);
    await connection.commit();
    const [[userCount]] = await connection.query("SELECT COUNT(*) AS count FROM trip_users");
    const [[tripCount]] = await connection.query("SELECT COUNT(*) AS count FROM trip_tools_trips");
    const [[adminCount]] = await connection.query("SELECT COUNT(*) AS count FROM trip_users WHERE role = 'admin' AND name = 'daniel.chow'");
    console.log(`Trip Tools ready: ${userCount.count} users, ${tripCount.count} shared trip(s), daniel.chow admin: ${adminCount.count === 1}.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
} finally {
  await pool.end();
}
