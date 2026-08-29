export const UI_VERSION = __ENVSYNC_UI_VERSION__;
export const UI_BUILD = __ENVSYNC_UI_BUILD__;

export function formatBuildLabel(prefix: string, version: string, build: string): string {
  return `${prefix} ${version} (${build})`;
}
