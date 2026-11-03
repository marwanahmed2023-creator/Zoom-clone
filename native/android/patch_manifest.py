from pathlib import Path
p = Path("android/app/src/main/AndroidManifest.xml")
s = p.read_text()
s = s.replace('    <application', '''    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <application''', 1)
if 'android:icon=' not in s:
    s = s.replace('    <application', '    <application\\n        android:icon="@mipmap/ic_launcher"\\n        android:roundIcon="@mipmap/ic_launcher_round"', 1)

needle = '        </activity>'
service = '''
        <service
            android:name=".CallListenerService"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Maintains the user's requested incoming Meet call connection and alerts them to calls" />
        </service>
'''
if 'android:name=".CallListenerService"' not in s:
    s = s.replace(needle, needle + service, 1)
p.write_text(s)
