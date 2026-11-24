import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const upstreamLicenses = [
  { match: (name) => name.startsWith("@esbuild/"), id: "MIT", url: "https://github.com/evanw/esbuild/blob/main/LICENSE.md", repo: "https://github.com/evanw/esbuild" },
  { match: (name) => name === "fsevents", id: "MIT", url: "https://github.com/fsevents/fsevents/blob/master/LICENSE", repo: "https://github.com/fsevents/fsevents" },
  { match: (name) => name.startsWith("@expo/modules-macros-"), id: "MIT", url: "https://github.com/expo/expo-modules-macros/blob/main/LICENSE", repo: "https://github.com/expo/expo-modules-macros" },
  { match: (name) => name.startsWith("@noxcturnal/noxcturnal-"), id: "MIT", url: "https://github.com/expo/noxcturnal/blob/main/LICENSE", repo: "https://github.com/expo/noxcturnal" },
  { match: (name) => name.startsWith("lightningcss-"), id: "MPL-2.0", url: "https://github.com/parcel-bundler/lightningcss/blob/master/LICENSE", repo: "https://github.com/parcel-bundler/lightningcss" },
  { match: (name) => name === "@emnapi/runtime", id: "MIT", url: "https://github.com/toyobayashi/emnapi/blob/main/LICENSE", repo: "https://github.com/toyobayashi/emnapi" },
  { match: (name) => name === "tslib", id: "0BSD", url: "https://github.com/microsoft/tslib/blob/main/LICENSE.txt", repo: "https://github.com/microsoft/tslib" },
  { match: (name) => name.startsWith("@img/sharp-libvips-"), id: "LGPL-3.0-or-later", url: "https://github.com/lovell/sharp-libvips/blob/main/LICENSE", repo: "https://github.com/lovell/sharp-libvips" },
  { match: (name) => name === "@img/sharp-wasm32", expression: "Apache-2.0 AND LGPL-3.0-or-later AND MIT", url: "https://github.com/lovell/sharp/blob/main/npm/wasm32/package.json", repo: "https://github.com/lovell/sharp" },
  { match: (name) => name === "@img/sharp-win32-x64", expression: "Apache-2.0 AND LGPL-3.0-or-later", url: "https://github.com/lovell/sharp/blob/main/npm/win32-x64/package.json", repo: "https://github.com/lovell/sharp" },
  { match: (name) => name.startsWith("@img/sharp-"), id: "Apache-2.0", url: "https://github.com/lovell/sharp/tree/main/npm", repo: "https://github.com/lovell/sharp" },
];

for (const project of ["api", "mobile"]) {
  const root = resolve(project);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const components = Object.entries(lock.packages).flatMap(([path, entry]) => {
    if (!path || !entry.version) return [];
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const localManifest = join(root, path, "package.json");
    let declaredLicense;
    try { declaredLicense = JSON.parse(readFileSync(localManifest, "utf8")).license; } catch { declaredLicense = undefined; }
    const upstream = typeof declaredLicense === "string" ? undefined : upstreamLicenses.find((candidate) => candidate.match(name));
    const licenses = typeof declaredLicense === "string"
      ? [{ license: { name: declaredLicense } }]
      : upstream ? [{ license: upstream.expression ? { expression: upstream.expression } : { id: upstream.id } }] : undefined;
    const integrity = entry.integrity?.match(/^(sha256|sha384|sha512)-(.+)$/);
    return [{
      type: "library", name, version: entry.version,
      purl: `pkg:npm/${name}@${encodeURIComponent(entry.version)}`,
      ...(licenses ? { licenses } : {}),
      ...(integrity ? { hashes: [{ alg: integrity[1].toUpperCase(), content: Buffer.from(integrity[2], "base64").toString("hex") }] } : {}),
      scope: "required",
      ...(upstream ? { externalReferences: [{ type: "vcs", url: upstream.repo }] } : {}),
      properties: [
        { name: "petcare:lockfile-path", value: path },
        { name: "petcare:package-lock-dev", value: String(Boolean(entry.dev)) },
        { name: "petcare:license-evidence", value: upstream?.url ?? (typeof declaredLicense === "string" ? "installed package.json license field" : "No license declaration or upstream mapping found") },
      ],
    }];
  });
  const bom = {
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX", specVersion: "1.5", version: 1,
    metadata: { component: { type: "application", name: manifest.name, version: manifest.version ?? "unversioned" } },
    components,
  };
  const output = join(root, "..", "docs", "audits", `petcare-${project}.cdx.json`);
  writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`, "utf8");
  const report = components.map(({ name, version, scope, licenses, properties }) => ({ name, version, scope, license: licenses?.[0]?.license?.name ?? licenses?.[0]?.license?.id ?? licenses?.[0]?.license?.expression ?? "UNDECLARED", licenseEvidence: properties[2].value, lockfilePath: properties[0].value }));
  writeFileSync(join(root, "..", "docs", "audits", `petcare-${project}-licenses.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`${project}: ${components.length} locked packages; ${report.filter((item) => item.license === "UNDECLARED").length} with no declared license.`);
}
