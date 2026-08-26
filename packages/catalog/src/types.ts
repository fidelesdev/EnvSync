export type PackageManager = "pacman" | "aur" | "flatpak" | "appimage";

export type PackageProvider = {
  type: "package";
  manager: PackageManager;
  name: string;
};

export type PathsProvider = {
  type: "paths";
  paths: string[];
  excludes?: string[];
};

export type EnvProvider = {
  type: "env";
  keys: string[];
};

export type ItemProvider = PackageProvider | PathsProvider | EnvProvider;

export type CatalogGroup = {
  id: string;
  label: string;
  icon: string;
};

export type CatalogItem = {
  id: string;
  label: string;
  groupId: string;
  providers: ItemProvider[];
};

export type Catalog = {
  groups: CatalogGroup[];
  items: CatalogItem[];
};
