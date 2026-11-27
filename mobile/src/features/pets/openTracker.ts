import { Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

export async function openTracker(): Promise<void> {
  if (Platform.OS === 'ios') {
    try { await Linking.openURL('findmy://'); return; } catch { /* app unavailable */ }
    await Linking.openURL('https://apps.apple.com/app/find-my/id1514844621');
    return;
  }
  if (Platform.OS === 'android') {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        packageName: 'com.google.android.apps.adm',
        category: 'android.intent.category.LAUNCHER',
      });
      return;
    } catch { /* app unavailable */ }
    try { await Linking.openURL('market://details?id=com.google.android.apps.adm'); }
    catch { await Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.adm'); }
    return;
  }
  throw new Error('Abre PetCare en un teléfono iOS o Android para rastrear la mascota.');
}
