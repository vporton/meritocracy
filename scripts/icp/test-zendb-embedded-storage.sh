#!/usr/bin/env bash
# Compile the M1 in-process ZenDB storage probe against the exact pinned
# source/dependency closure. This is a local compiler proof only: it does not
# invoke DFX, PocketIC, a network, identity, wallet, or canister installation.
set -euo pipefail

readonly source_commit="481d9cdac1ac41f01ba7892cfa720dbe4e87e4cd"
readonly source_archive_sha256="332e88c5ed8a777472d0843597d0b3c080b5b6f6e53d251b52aa0883b3444844"
readonly source_mops_toml_sha256="09f5e7cd4281ca46953419cdad9fa1a1b376d211288a66af780f505b07336d18"
readonly source_mops_lock_sha256="79b2a699c484e57ee5bbaa20e50d1da7c556c4e3a132ff7a655523eeffced267"
readonly expected_mops_version="CLI 2.19.2"
readonly expected_moc_version="Motoko compiler 1.4.1"
readonly expected_repository_moc_version="Motoko compiler 1.4.1"

compiler_mode="zendb"
case "${1:-}" in
  "" | --compiler=zendb) ;;
  --compiler=repository) compiler_mode="repository" ;;
  *)
    echo "Usage: $0 [--compiler=zendb|--compiler=repository]" >&2
    exit 2
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
probe_source="$repo_root/fixtures/zendb/M1EmbeddedStorageProbe.mo"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
workdir="$(mktemp -d /tmp/meritocracy-zendb-embedded.XXXXXXXX)"
source_dir="$workdir/zendb"

cleanup() {
  rm -rf -- "$workdir"
}
trap cleanup EXIT

for command in git node sha256sum tar install cp; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done
[[ -f "$probe_source" ]] || {
  echo "Missing embedded ZenDB probe: $probe_source" >&2
  exit 1
}
[[ "$("${mops_cli[@]}" --version | head -n 1)" == "$expected_mops_version" ]] || {
  echo "Expected Mops $expected_mops_version; found: $("${mops_cli[@]}" --version | head -n 1)" >&2
  exit 1
}

# Do not clone or fetch here. The operator supplies an existing checkout, and
# an exact git archive is created before any fixture is injected so that the
# source remains read-only and provenance is independently checked.
provided_source_dir="${M1_ZENDB_SOURCE_DIR:-}"
[[ -d "$provided_source_dir/.git" ]] || {
  echo "M1_ZENDB_SOURCE_DIR must name an existing ZenDB git checkout" >&2
  exit 1
}
git -C "$provided_source_dir" rev-parse --verify "$source_commit^{commit}" >/dev/null
[[ -d "$provided_source_dir/.mops" ]] || {
  echo "M1_ZENDB_SOURCE_DIR must include its already-resolved .mops dependency closure" >&2
  exit 1
}
source_archive="$workdir/zendb-source.tar"
# A partial/promisor checkout must fail rather than fetch a missing object.
GIT_NO_LAZY_FETCH=1 git -C "$provided_source_dir" archive --format=tar "$source_commit" > "$source_archive"
[[ "$(sha256sum "$source_archive" | awk '{print $1}')" == "$source_archive_sha256" ]] || {
  echo "Provided ZenDB source does not match the pinned archive" >&2
  exit 1
}
mkdir "$source_dir"
tar -xf "$source_archive" -C "$source_dir"
[[ "$(sha256sum "$source_dir/mops.toml" | awk '{print $1}')" == "$source_mops_toml_sha256" ]]
[[ "$(sha256sum "$source_dir/mops.lock" | awk '{print $1}')" == "$source_mops_lock_sha256" ]]

# Mops resolves package paths beneath `.mops`. Copy only an already-resolved
# closure from the supplied checkout; do not run `mops install` or make a
# registry request. Every lock-recorded source file is checked after the copy
# before the compiler is given a package path.
cp -a "$provided_source_dir/.mops" "$source_dir/.mops"
node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const path = require("node:path");
  const root = process.argv[1];
  const lock = JSON.parse(fs.readFileSync(path.join(root, "mops.lock"), "utf8"));
  for (const files of Object.values(lock.hashes)) {
    if (typeof files !== "object" || files === null) continue;
    for (const [relative, expected] of Object.entries(files)) {
      const target = path.join(root, ".mops", relative);
      if (!fs.statSync(target).isFile()) throw new Error(`Missing pinned dependency file: ${relative}`);
      const actual = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
      if (actual !== expected) throw new Error(`Pinned dependency hash mismatch: ${relative}`);
    }
  }
' "$source_dir"

# The repository compiler probe is intentionally separate from the pin's
# compiler probe. A successful pin build does not demonstrate that this
# repository can embed the candidate under its approved toolchain.
case "$compiler_mode" in
  zendb)
    moc_path="$(cd "$source_dir" && "${mops_cli[@]}" toolchain bin moc)"
    [[ "$("$moc_path" --version | head -n 1)" == "$expected_moc_version"* ]] || {
      echo "Expected pinned ZenDB moc $expected_moc_version; found: $("$moc_path" --version | head -n 1)" >&2
      exit 1
    }
    ;;
  repository)
    # Use Mops' project-selected compiler rather than an ambient PATH entry.
    # This proves the application toolchain itself is the exact ZenDB compiler;
    # it never introduces a second compiler path.
    moc_path="$(cd "$repo_root" && "${mops_cli[@]}" toolchain bin moc)"
    [[ "$("$moc_path" --version | head -n 1)" == "$expected_repository_moc_version"* ]] || {
      echo "Expected repository moc $expected_repository_moc_version; found: $("$moc_path" --version | head -n 1)" >&2
      exit 1
    }
    ;;
esac

install -m 0644 "$probe_source" "$source_dir/tests/M1EmbeddedStorageProbe.mo"
source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  source_args+=("${source_line_args[@]}")
done < <(cd "$source_dir" && "${mops_cli[@]}" sources --no-install)

compiler_log="$workdir/m1-embedded-storage-probe.log"
if ! (cd "$source_dir" && "$moc_path" \
  --enhanced-orthogonal-persistence \
  -o="$workdir/m1-embedded-storage-probe.wasm" \
  "${source_args[@]}" \
  "tests/M1EmbeddedStorageProbe.mo") >"$compiler_log" 2>&1; then
  cat "$compiler_log" >&2
  exit 1
fi
[[ -s "$workdir/m1-embedded-storage-probe.wasm" ]]

echo "ZenDB v2.0.1 embedded-storage compile proof passed with $compiler_mode compiler."
