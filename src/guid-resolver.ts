/**
 * Resolve Unity script GUIDs to human-readable names.
 *
 * Two sources:
 * 1. Built-in Unity component GUIDs (globally consistent)
 * 2. Project-specific .cs.meta files (scanned at runtime)
 */

import * as fs from 'fs';
import * as path from 'path';

/** Well-known current Unity UI component script GUIDs. */
const BUILTIN_GUIDS: Record<string, string> = {
  // UnityEngine.UI
  'fe87c0e1cc204ed48ad3b37840f39efc': 'Image',
  '5f7201a12d95ffc409449d95f23cf332': 'Text',
  '1344c3c82d62a2a41a3576d8abb8e3ea': 'RawImage',
  '4e29b1a8efbd4b44bb3f3716e73f07ff': 'Button',
  '9085046f02f69544eb97fd06b6048fe2': 'Toggle',
  '67db9e8f0e2ae9c40bc1e2b64352a6b4': 'Slider',
  '2a4db7a114972834c8e4117be1d82ba3': 'Scrollbar',
  '1aa08ab6e0800fa44ae55d278d1423e3': 'ScrollRect',
  'd199490a83bb2b844b9695cbf13b01ef': 'InputField',
  '0d0b652f32a2cc243917e4028fa0f046': 'Dropdown',
  '306cc8c2b49d7114eaa3623786fc2126': 'LayoutElement',
  '30649d3a9faa99c48a7b1166b86bf2a0': 'HorizontalLayoutGroup',
  '59f8146938fff824cb5fd77236b75775': 'VerticalLayoutGroup',
  '8a8695521f0d02e499659fee002a26c2': 'GridLayoutGroup',
  '3245ec927659c4140ac4f8d17403cc18': 'ContentSizeFitter',
  '86710e43de46f6f4bac7c8e50813a599': 'AspectRatioFitter',
  'dc42784cf147c0c48a680349fa168899': 'GraphicRaycaster',
  '31a19414c41e5ae4aae2af33fee712f6': 'Mask',
  '3312d7739989d2b4e91e6319e9a96d76': 'RectMask2D',

  // TextMeshPro
  'f4688fdb7df04437aeb418b961361dc5': 'TextMeshProUGUI',
  '9541d86e2fd84c1d9990edf0852d74ab': 'TextMeshPro',
  '2da0c512f12947e489f739169773d7ca': 'TMP_InputField',

  // EventSystem
  '76c392e42b5098c458856cdf6ecaaaa1': 'EventSystem',
  '4f231c4fb786f3946a6b90b886c48677': 'StandaloneInputModule',
  '1ea10891dd782154ca0fb67bce9e6f72': 'BaseInputModule',
  'c49b4cc203aa6414fae5c798d1d0e7d6': 'PhysicsRaycaster',
};

/** Script GUID aliases emitted by older Unity UI package versions. */
const LEGACY_BUILTIN_GUIDS: Record<string, string> = {
  'f70555f144d8491a825f0804e09c671c': 'Image',
};

/** GuidResolver maps script GUIDs to human-readable class names */
export class GuidResolver {
  /** GUID → display name for both scripts and named assets. */
  private map = new Map<string, string>();
  /** Script name → every known script GUID; assets never enter this index. */
  private scriptGuidsByName = new Map<string, Set<string>>();
  /** Project/manual mappings take precedence over built-in defaults. */
  private projectScriptGuidsByName = new Map<string, Set<string>>();
  private preferredBuiltinGuidByName = new Map<string, string>();
  /** GUID → absolute file path for asset files (.prefab, .unity, etc.) */
  private assetPaths = new Map<string, string>();

  constructor() {
    for (const [guid, name] of Object.entries(BUILTIN_GUIDS)) {
      this.registerScript(guid, name, false);
      this.preferredBuiltinGuidByName.set(name, guid);
    }
    for (const [guid, name] of Object.entries(LEGACY_BUILTIN_GUIDS)) {
      this.registerScript(guid, name, false);
    }
  }

  private registerScript(guid: string, name: string, projectSpecific: boolean): void {
    this.map.set(guid, name);
    const all = this.scriptGuidsByName.get(name) || new Set<string>();
    all.add(guid);
    this.scriptGuidsByName.set(name, all);
    if (projectSpecific) {
      const project = this.projectScriptGuidsByName.get(name) || new Set<string>();
      project.add(guid);
      this.projectScriptGuidsByName.set(name, project);
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
        this.registerScript(match[1], className, true);
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

  /** Resolve a script/component name to one safe GUID for component creation. */
  resolveGuid(name: string): string | undefined {
    const projectGuids = [...(this.projectScriptGuidsByName.get(name) || [])];
    if (projectGuids.length === 1) return projectGuids[0];
    if (projectGuids.length > 1) return undefined;
    return this.preferredBuiltinGuidByName.get(name)
      || this.onlyGuid(this.scriptGuidsByName.get(name));
  }

  /** Resolve every known script GUID for validation of an existing document. */
  resolveScriptGuids(name: string): string[] {
    return [...(this.scriptGuidsByName.get(name) || [])];
  }

  private onlyGuid(guids?: Set<string>): string | undefined {
    if (!guids || guids.size !== 1) return undefined;
    return guids.values().next().value;
  }

  /** Resolve a GUID to the asset file path */
  resolveFilePath(guid: string): string | undefined {
    return this.assetPaths.get(guid);
  }

  /** Add a manual mapping */
  add(guid: string, name: string): void {
    this.registerScript(guid, name, true);
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
