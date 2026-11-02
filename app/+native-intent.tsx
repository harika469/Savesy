/**
 * The iOS share extension reopens the app with savesy://dataUrl=savesyShareKey.
 * That isn't a real screen, so route it to Save; ShareIntentHandler fills in the shared link.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes('dataUrl=')) return '/add';
    return path;
  } catch {
    return '/';
  }
}
