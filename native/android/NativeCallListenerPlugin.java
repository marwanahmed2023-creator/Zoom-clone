package com.meet.app;

import android.Manifest;
import android.content.Intent;
import android.app.NotificationManager;
import android.net.Uri;
import android.provider.Settings;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

@CapacitorPlugin(
    name = "NativeCallListener",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class NativeCallListenerPlugin extends Plugin {
    @PluginMethod
    public void requestMediaPermissions(PluginCall call) {
        // Ask for both in one Android permission flow. A denied camera must not
        // prevent the user from joining with microphone-only access.
        requestPermissionForAliases(new String[] { "camera", "microphone" }, call, "mediaPermissionsResult");
    }

    @PermissionCallback
    private void mediaPermissionsResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            call.resolve();
        } else {
            call.reject("Microphone permission was not granted. Allow Convo to use the microphone in Android app settings.");
        }
    }


    @PluginMethod
    public void getFullScreenIntentStatus(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            allowed = manager != null && manager.canUseFullScreenIntent();
        }
        JSObject result = new JSObject();
        result.put("allowed", allowed);
        call.resolve(result);
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            if (manager == null || !manager.canUseFullScreenIntent()) {
                Intent settings = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                settings.setData(Uri.parse("package:" + getContext().getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String identity = call.getString("identity", "").trim();
        if (identity.isEmpty()) {
            call.reject("Save your Meet display name first.");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "startAfterPermission");
            return;
        }
        startService(identity, call);
    }

    @PermissionCallback
    private void startAfterPermission(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Notification permission is required for incoming call alerts.");
            return;
        }
        startService(call.getString("identity", "").trim(), call);
    }

    private void startService(String identity, PluginCall call) {
        if (identity.isEmpty()) {
            call.reject("Save your Meet display name first.");
            return;
        }
        Intent intent = new Intent(getContext(), CallListenerService.class);
        intent.setAction(CallListenerService.ACTION_START);
        intent.putExtra("identity", identity);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), CallListenerService.class);
        intent.setAction(CallListenerService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void getPendingCall(PluginCall call) {
        String room = getContext().getSharedPreferences("meet_native_calls", 0).getString("pending_room", "");
        JSObject result = new JSObject();
        result.put("room", room);
        call.resolve(result);
    }

    @PluginMethod
    public void clearPendingCall(PluginCall call) {
        getContext().getSharedPreferences("meet_native_calls", 0).edit().remove("pending_room").apply();
        call.resolve();
    }
}