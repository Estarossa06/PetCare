import type { Migration } from "./types.js";
const migration: Migration = { version: 5, name: "pet_tracking", async up(client) {
 await client.query(`CREATE TABLE pet_trackers (pet_id uuid PRIMARY KEY REFERENCES pets(id) ON DELETE CASCADE, device_id integer NOT NULL UNIQUE, safe_radius_m integer NOT NULL DEFAULT 1000 CHECK (safe_radius_m BETWEEN 100 AND 1000), home_lat double precision, home_lon double precision, CHECK ((home_lat IS NULL) = (home_lon IS NULL)), CHECK (home_lat BETWEEN -90 AND 90), CHECK (home_lon BETWEEN -180 AND 180));`);
}};
export default migration;
