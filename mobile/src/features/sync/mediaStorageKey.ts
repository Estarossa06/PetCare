export function remoteMediaStorageKey(
  accountId: string,
  assetId: string,
  filename: string,
  resourceType: "pet_photo" | "health_attachment",
): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(accountId) || !uuid.test(assetId)) throw new Error("Invalid account or media identifier.");
  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).toLowerCase().replace(/[^.a-z0-9]/g, "")
    : ".bin";
  const directory = resourceType === "pet_photo" ? "pet-photos" : "medical-files";
  return `${directory}/remote-${accountId}-${assetId}${extension}`;
}
