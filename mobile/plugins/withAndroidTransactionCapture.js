const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

function withCaptureManifest(config) {
  return withAndroidManifest(config, config => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android application manifest entry not found.');
    application.service ??= [];
    application.service = application.service.filter(service => service.$?.['android:name'] !== '.TransactionCaptureService');
    application.service.push({
      $: {
        'android:name': '.TransactionCaptureService',
        'android:label': 'Paisa Pilot transaction notification filter',
        'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        'android:exported': 'false',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.notification.NotificationListenerService' } }] }],
    });
    return config;
  });
}

function withCaptureSources(config) {
  return withDangerousMod(config, ['android', async config => {
    const packageName = config.android.package;
    const packagePath = packageName.replaceAll('.', '/');
    const sourceDir = path.join(config.modRequest.projectRoot, 'android', 'app', 'src', 'main', 'java', packagePath);
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.copyFile(path.join(__dirname, 'native', 'TransactionCaptureService.kt'), path.join(sourceDir, 'TransactionCaptureService.kt'));
    await fs.copyFile(path.join(__dirname, 'native', 'TransactionCaptureModule.kt'), path.join(sourceDir, 'TransactionCaptureModule.kt'));
    await fs.copyFile(path.join(__dirname, 'native', 'TransactionCapturePackage.kt'), path.join(sourceDir, 'TransactionCapturePackage.kt'));
    return config;
  }]);
}

function withCapturePackageRegistration(config) {
  return withMainApplication(config, config => {
    const source = config.modResults.contents;
    if (source.includes('TransactionCapturePackage()')) return config;
    const marker = 'PackageList(this).packages.apply {';
    if (!source.includes(marker)) throw new Error('Could not find the Expo package registration block in MainApplication.kt.');
    config.modResults.contents = source.replace(marker, `${marker}\n        add(TransactionCapturePackage())`);
    return config;
  });
}

module.exports = config => withCapturePackageRegistration(withCaptureSources(withCaptureManifest(config)));
