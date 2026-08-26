export type ItemPresence = "present" | "absent";

export type ItemInventory = {
  itemId: string;
  fingerprint: string;
  presence: ItemPresence;
  detail: string;
};
