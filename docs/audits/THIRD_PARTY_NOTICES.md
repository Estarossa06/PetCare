# Third-party notices

PetCare uses `caniuse-lite` data derived from Can I Use. The dataset is licensed under Creative Commons Attribution 4.0 International (CC BY 4.0). Attribution: data from [Can I Use](https://caniuse.com/), maintained by Alexis Deveria and contributors; see the [caniuse-lite repository](https://github.com/browserslist/caniuse-lite) and its included license for the applicable notice.

The API image decoder uses Sharp and platform-specific libvips binaries. Preserve the upstream notices and third-party license information when distributing the API runtime: [Sharp license](https://github.com/lovell/sharp/blob/main/LICENSE), [libvips packaging notices](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md). Platform packages can carry Apache-2.0, LGPL-3.0-or-later, MIT, and other listed third-party terms; use the files shipped for the exact platform artifact.

This notice file records attribution and a distribution reminder. It is not a substitute for legal review or for shipping the actual license texts required by the selected dependencies and target platforms.

## Lockfile review: selected mobile tooling packages

The current mobile lockfile contains `node-forge@1.4.3` transitively through
`@expo/code-signing-certificates` → Expo CLI. Its installed package declares
`(BSD-3-Clause OR GPL-2.0)` and ships a `LICENSE` containing both terms. The
upstream Forge repository also publishes that dual license and recommends the
BSD option for most users. It is current in the lockfile and was not identified
as abandoned. Distribution owners must preserve the applicable notice and
confirm the chosen license option for their use. [Upstream LICENSE](https://github.com/digitalbazaar/forge/blob/main/LICENSE)

The lockfile includes `lightningcss@1.33.0` and platform packages through
Expo Metro configuration. The installed package metadata and upstream
`LICENSE` identify MPL-2.0. It is build tooling but is still inventoried in the
full lockfile SBOM. Preserve MPL notices if distributing covered binaries or
modifications. [Upstream LICENSE](https://github.com/parcel-bundler/lightningcss/blob/master/LICENSE)

The lockfile includes `caniuse-lite@1.0.30001823` through Browserslist and
Expo build tooling. Its included LICENSE applies CC BY 4.0 to compatibility
data; the upstream repository asks users to attribute caniuse.com. The package
is actively maintained and should not be described as abandoned based on the
review performed here. [Upstream LICENSE](https://github.com/browserslist/caniuse-lite/blob/main/LICENSE)

The npm SBOMs are regenerated from the lockfiles and now include package
dependency edges. License identifiers are inventory evidence sourced from the
installed package metadata or a recorded upstream mapping; they are not a
legal determination and do not substitute for review of all shipped files and
notices. The separate model BOM inventories Ollama artifacts, which are not
represented by either npm lockfile.
