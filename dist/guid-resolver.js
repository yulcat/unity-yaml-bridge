"use strict";
/**
 * Resolve Unity script GUIDs to human-readable names.
 *
 * Two sources:
 * 1. Built-in Unity component GUIDs (globally consistent)
 * 2. Project-specific .cs.meta files (scanned at runtime)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuidResolver = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Well-known current Unity UI component script GUIDs. */
const BUILTIN_GUIDS = {
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
const LEGACY_BUILTIN_GUIDS = {
    'f70555f144d8491a825f0804e09c671c': 'Image',
};
/** GuidResolver maps script GUIDs to human-readable class names */
class GuidResolver {
    constructor() {
        /** GUID → display name for both scripts and named assets. */
        this.map = new Map();
        /** Script name → every known script GUID; assets never enter this index. */
        this.scriptGuidsByName = new Map();
        /** Project/manual mappings take precedence over built-in defaults. */
        this.projectScriptGuidsByName = new Map();
        this.preferredBuiltinGuidByName = new Map();
        /** GUID → absolute file path for asset files (.prefab, .unity, etc.) */
        this.assetPaths = new Map();
        for (const [guid, name] of Object.entries(BUILTIN_GUIDS)) {
            this.registerScript(guid, name, false);
            this.preferredBuiltinGuidByName.set(name, guid);
        }
        for (const [guid, name] of Object.entries(LEGACY_BUILTIN_GUIDS)) {
            this.registerScript(guid, name, false);
        }
    }
    registerScript(guid, name, projectSpecific) {
        this.map.set(guid, name);
        const all = this.scriptGuidsByName.get(name) || new Set();
        all.add(guid);
        this.scriptGuidsByName.set(name, all);
        if (projectSpecific) {
            const project = this.projectScriptGuidsByName.get(name) || new Set();
            project.add(guid);
            this.projectScriptGuidsByName.set(name, project);
        }
    }
    /** Scan a Unity project folder for .cs.meta and asset .meta files */
    scanProject(projectPath) {
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
    scanDirectory(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return; // Skip unreadable directories
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                this.scanDirectory(fullPath);
            }
            else if (entry.name.endsWith('.cs.meta')) {
                this.readScriptMetaFile(fullPath);
            }
            else if (entry.name.endsWith('.prefab.meta') || entry.name.endsWith('.unity.meta')) {
                this.readAssetMetaFile(fullPath);
            }
        }
    }
    /** Read a .cs.meta file and extract the GUID → class name mapping */
    readScriptMetaFile(metaPath) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8');
            const match = content.match(/guid:\s*([a-f0-9]{32})/);
            if (match) {
                // Class name from filename: "SomeScript.cs.meta" → "SomeScript"
                const className = path.basename(metaPath, '.cs.meta');
                this.registerScript(match[1], className, true);
            }
        }
        catch {
            // Skip unreadable files
        }
    }
    /** Read an asset .meta file and store GUID → file path mapping */
    readAssetMetaFile(metaPath) {
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
        }
        catch {
            // Skip unreadable files
        }
    }
    /** Resolve a GUID to a human-readable name */
    resolve(guid) {
        return this.map.get(guid);
    }
    /** Resolve a script/component name to one safe GUID for component creation. */
    resolveGuid(name) {
        const projectGuids = [...(this.projectScriptGuidsByName.get(name) || [])];
        if (projectGuids.length === 1)
            return projectGuids[0];
        if (projectGuids.length > 1)
            return undefined;
        return this.preferredBuiltinGuidByName.get(name)
            || this.onlyGuid(this.scriptGuidsByName.get(name));
    }
    /** Resolve every known script GUID for validation of an existing document. */
    resolveScriptGuids(name) {
        return [...(this.scriptGuidsByName.get(name) || [])];
    }
    onlyGuid(guids) {
        if (!guids || guids.size !== 1)
            return undefined;
        return guids.values().next().value;
    }
    /** Resolve a GUID to the asset file path */
    resolveFilePath(guid) {
        return this.assetPaths.get(guid);
    }
    /** Add a manual mapping */
    add(guid, name) {
        this.registerScript(guid, name, true);
    }
    /** Add a manual asset mapping */
    addAsset(guid, assetPath, name) {
        this.assetPaths.set(guid, assetPath);
        if (name && !this.map.has(guid)) {
            this.map.set(guid, name);
        }
    }
    /** Get the number of mappings */
    get size() {
        return this.map.size;
    }
}
exports.GuidResolver = GuidResolver;
//# sourceMappingURL=guid-resolver.js.map