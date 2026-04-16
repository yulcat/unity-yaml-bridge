/**
 * Resolve Unity script GUIDs to human-readable names.
 *
 * Two sources:
 * 1. Built-in Unity component GUIDs (globally consistent)
 * 2. Project-specific .cs.meta files (scanned at runtime)
 */

import * as fs from 'fs';
import * as path from 'path';

/** Well-known built-in Unity component GUIDs */
const BUILTIN_GUIDS: Record<string, string> = {
  // UnityEngine.UI
  'f70555f144d8491a825f0804e09c671c': 'Image',
  'fe87c0e1cc204ed48ad3b37840f39efc': 'Text',
  '1367256e42f64b53afb3d12e1d0a7cff': 'RawImage',
  '4e29b1a8efbd4b44bd927f3ae6b005da': 'Button',
  '2a4db911460183942a0cdb7110b0cefe': 'Toggle',
  '59f8146938fff824cb5fd77236b75b02': 'Slider',
  'fe9aa2a2e72072d42a0d4bde98e2e8bb': 'Scrollbar',
  '1aa08ab6e0e84e6db56286a8b843237f': 'ScrollRect',
  'd199490a83bb2b844b9695cbf13b01ef': 'InputField',
  'b916b2e613c5a9d4bbe7b4eab0cc68d5': 'Dropdown',
  '3245ec927659c4140ac4f8d17db3e860': 'LayoutElement',
  'dc8f7e29fe73f7144ae6f7bec77b32f5': 'HorizontalLayoutGroup',
  '59f4986de759f0d49bc36faa08bb6a9c': 'VerticalLayoutGroup',
  '8a8695b1d2013e149b8ba1613c7c14c7': 'GridLayoutGroup',
  'ef4ba1b2de524bf4a80032869ec89a23': 'ContentSizeFitter',
  'a5a932db66a982046ac69a250a7efe85': 'AspectRatioFitter',
  '3312d537c5dd4cc5ab17c0ef57caaa53': 'GraphicRaycaster',
  '0cd44c1031e13a943bb63640046fad76': 'Mask',
  '31a19414c41e5ae4aae2af33c9f705e7': 'RectMask2D',

  // TextMeshPro
  'f4688fdb7df04437aeb418b961361dc5': 'TextMeshProUGUI',
  'b9839c2d141782e41b2a5b7b14890d4b': 'TextMeshPro',
  '2a4db911460183942a0cdb7110b0cefe2': 'TMP_InputField',

  // EventSystem
  '4f231c4fb786f3946a523354b45a0805': 'EventSystem',
  'd13b0893fc8a7c840a76af930e6f0ace': 'StandaloneInputModule',
  '01614664b831546d2ae94a42149bc3e1': 'BaseInputModule',
  '76c392e42b5d94c456ad7f359ceb7ad3': 'PhysicsRaycaster',
};

/** GuidResolver maps script GUIDs to human-readable class names */
export class GuidResolver {
  private map = new Map<string, string>();
  /** GUID → absolute file path for asset files (.prefab, .unity, etc.) */
  private assetPaths = new Map<string, string>();

  constructor() {
    // Load built-in GUIDs
    for (const [guid, name] of Object.entries(BUILTIN_GUIDS)) {
      this.map.set(guid, name);
    }
  }

  /** Scan a Unity project folder for .cs.meta and asset .meta files */
  scanProject(projectPath: string): void {
    const assetsPath = path.join(projectPath, 'Assets');
    if (fs.existsSync(assetsPath)) {
      this.scanDirectory(assetsPath);
    }

    // Also scan Packages/ (local packages and package references)
    const packagesPath = path.join(projectPath, 'Packages');
    if (fs.existsSync(packagesPath)) {
      this.scanDirectory(packagesPath);
    }

    // Also scan Library/PackageCache/ (downloaded package cache)
    const packageCachePath = path.join(projectPath, 'Library', 'PackageCache');
    if (fs.existsSync(packageCachePath)) {
      this.scanDirectory(packageCachePath);
    }
  }

  /** Recursively scan a directory for .meta files */
  private scanDirectory(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.scanDirectory(fullPath);
      } else if (entry.name.endsWith('.cs.meta')) {
        this.readScriptMetaFile(fullPath);
      } else if (entry.name.endsWith('.prefab.meta') || entry.name.endsWith('.unity.meta')) {
        this.readAssetMetaFile(fullPath);
      }
    }
  }

  /** Read a .cs.meta file and extract the GUID → class name mapping */
  private readScriptMetaFile(metaPath: string): void {
    try {
      const content = fs.readFileSync(metaPath, 'utf-8');
      const match = content.match(/guid:\s*([a-f0-9]{32})/);
      if (match) {
        // Class name from filename: "SomeScript.cs.meta" → "SomeScript"
        const className = path.basename(metaPath, '.cs.meta');
        this.map.set(match[1], className);
      }
    } catch {
      // Skip unreadable files
    }
  }

  /** Read an asset .meta file and store GUID → file path mapping */
  private readAssetMetaFile(metaPath: string): void {
    try {
      const content = fs.readFileSync(metaPath, 'utf-8');
      const match = content.match(/guid:\s*([a-f0-9]{32})/);
      if (match) {
        // Asset path: remove the .meta suffix to get the actual asset file
        const assetPath = metaPath.replace(/\.meta$/, '');
        this.assetPaths.set(match[1], assetPath);
        // Also store the asset name as a name mapping (e.g., "_Card_Template")
        const ext = path.extname(assetPath);
        const assetName = path.basename(assetPath, ext);
        if (!this.map.has(match[1])) {
          this.map.set(match[1], assetName);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  /** Resolve a GUID to a human-readable name */
  resolve(guid: string): string | undefined {
    return this.map.get(guid);
  }

  /** Resolve a GUID to the asset file path */
  resolveFilePath(guid: string): string | undefined {
    return this.assetPaths.get(guid);
  }

  /** Add a manual mapping */
  add(guid: string, name: string): void {
    this.map.set(guid, name);
  }

  /** Add a manual asset mapping */
  addAsset(guid: string, assetPath: string, name?: string): void {
    this.assetPaths.set(guid, assetPath);
    if (name && !this.map.has(guid)) {
      this.map.set(guid, name);
    }
  }

  /** Get the number of mappings */
  get size(): number {
    return this.map.size;
  }
}
