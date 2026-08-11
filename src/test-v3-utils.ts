import { compileV3 } from './v3/compiler';
import { readV3 } from './v3/reader';
import { compareLocalPrefabSemantics } from './v3/semantic-normalizer';
import { writeV3 } from './v3/writer';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeUnityYaml } from './unity-yaml-writer';
import { UnityFile } from './types';

export interface ColdRoundTripResult {
  original: UnityFile;
  v3Text: string;
  rebuiltText: string;
  rebuilt: UnityFile;
}

/** The only input crossing the cold boundary is serialized v3 text. */
export function coldRoundTripV3(yaml: string): ColdRoundTripResult {
  const original = parseUnityYaml(yaml);
  const v3Text = writeV3(original);

  // Do not pass yaml or original to either readV3 or compileV3.
  const rebuiltText = writeUnityYaml(compileV3(readV3(String(v3Text))));
  const rebuilt = parseUnityYaml(rebuiltText);
  return { original, v3Text, rebuiltText, rebuilt };
}

export function describeSemanticDifference(expected: UnityFile, actual: UnityFile): string | null {
  const difference = compareLocalPrefabSemantics(expected, actual);
  if (!difference) return null;
  return `${difference.path}: expected ${JSON.stringify(difference.expected)}, ` +
    `actual ${JSON.stringify(difference.actual)}`;
}
