/** Portable GUID resolver for the checked-in sample suite. */

import * as fs from 'fs';
import * as path from 'path';
import { GuidResolver } from './guid-resolver';

export function createSampleResolver(samplesDir: string): GuidResolver {
  const resolver = new GuidResolver();
  const projectPath = path.join(
    samplesDir,
    'unity-projects',
    'PrefabWorkflows_UIDemo',
    'PrefabWorkflows_UIDemo_Project'
  );
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
  resolver.addAsset(
    '2982fa53447c5c643865bbd0d194eab1',
    path.join(samplesDir, 'prefabs', '_Card_Template.prefab'),
    '_Card_Template'
  );
  resolver.addAsset(
    '4363f8259f7f14e418706d51b057d9f3',
    path.join(fixtureDir, '_Header_Text.prefab'),
    '_Header_Text'
  );
  resolver.addAsset(
    'de624dab09f28584fa6f3e2ddc3d0d3b',
    path.join(fixtureDir, 'Paragraph_Text.prefab'),
    'Paragraph_Text'
  );
  resolver.addAsset(
    'd06aea9cb778d4741bb5f11c640fdb9e',
    path.join(fixtureDir, 'Medal_Template.prefab'),
    'Medal_Template'
  );
  return resolver;
}
