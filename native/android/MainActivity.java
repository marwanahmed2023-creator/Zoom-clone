package com.meet.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int MEDIA_PERMISSION_REQUEST = 7314;
    private PermissionRequest pendingWebPermissionRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeCallListenerPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebPermissionRequest == request) pendingWebPermissionRequest = null;
            }
        });
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        boolean wantsMedia = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) ||
                PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsMedia = true;
        }
        if (!wantsMedia) {
            request.deny();
            return;
        }
        boolean cameraGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        boolean micGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        if (cameraGranted && micGranted) {
            request.grant(request.getResources());
            return;
        }
        if (pendingWebPermissionRequest != null) pendingWebPermissionRequest.deny();
        pendingWebPermissionRequest = request;
        requestPermissions(new String[] { Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO }, MEDIA_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MEDIA_PERMISSION_REQUEST || pendingWebPermissionRequest == null) return;
        boolean cameraGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        boolean micGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        if (cameraGranted && micGranted) pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
        else pendingWebPermissionRequest.deny();
        pendingWebPermissionRequest = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (getBridge() != null) getBridge().triggerWindowJSEvent("meetNativeResume", "{}");
    }
}
