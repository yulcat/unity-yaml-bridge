"use strict";
/** Portable GUID resolver for the checked-in sample suite. */
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
exports.createSampleResolver = createSampleResolver;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const guid_resolver_1 = require("./guid-resolver");
function createSampleResolver(samplesDir) {
    const resolver = new guid_resolver_1.GuidResolver();
    const projectPath = path.join(samplesDir, 'unity-projects', 'PrefabWorkflows_UIDemo', 'PrefabWorkflows_UIDemo_Project');
    if (process.env.UBRIDGE_FORCE_FIXTURES !== '1' && fs.existsSync(projectPath)) {
        resolver.scanProject(projectPath);
        return resolver;
    }
    const fixtureDir = path.join(samplesDir, 'fixtures', 'PrefabWorkflows_UIDemo');
    resolver.add('9d7c3f249fc4309468af0da8b9aadc60', 'CameraFacingBillboard');
    resolver.add('9208535555d3a8240ace8b8bd8270dfb', 'CardBehaviour');
    resolver.add('972d2ab202f4c7742aa210c364a56a05', 'ActivatePanelUI');
    resolver.add('d24ab75cc4c08e34caf2dc26b116aff2', 'MedalDisplayUI');
    resolver.add('0cdb5f8b1f6f4f34f9ce7f9f5f7b67f0', 'UIParticles');
    resolver.addAsset('2982fa53447c5c643865bbd0d194eab1', path.join(samplesDir, 'prefabs', '_Card_Template.prefab'), '_Card_Template');
    resolver.addAsset('4363f8259f7f14e418706d51b057d9f3', path.join(fixtureDir, '_Header_Text.prefab'), '_Header_Text');
    resolver.addAsset('de624dab09f28584fa6f3e2ddc3d0d3b', path.join(fixtureDir, 'Paragraph_Text.prefab'), 'Paragraph_Text');
    resolver.addAsset('d06aea9cb778d4741bb5f11c640fdb9e', path.join(fixtureDir, 'Medal_Template.prefab'), 'Medal_Template');
    return resolver;
}
//# sourceMappingURL=test-sample-resolver.js.map