package com.meet.app;

import android.app.*;
import android.content.*;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.*;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

public class CallListenerService extends Service {
    static final String ACTION_START = "com.meet.app.START";
    static final String ACTION_STOP = "com.meet.app.STOP";
    static final String ACTION_ACCEPT = "com.meet.app.ACCEPT";
    static final String ACTION_DECLINE = "com.meet.app.DECLINE";
    private static final String BASE_URL = "https://zoom-clone.pages.dev";
    private static final String IDLE_CHANNEL = "meet_listener";
    private static final String CALL_CHANNEL = "meet_incoming_call";
    private static final int SERVICE_ID = 4100;
    private static final int CALL_ID = 4101;

    private ScheduledExecutorService worker;
    private String identity = "";
    private String activeRoom = "";
    private String activeCaller = "";
    private String suppressedRoom = "";
    private MediaPlayer ringtone;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override public void onCreate() {
        super.onCreate();
        createChannels();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopListener();
            return START_NOT_STICKY;
        }
        if (ACTION_ACCEPT.equals(action) || ACTION_DECLINE.equals(action)) {
            if (identity == null || identity.isEmpty()) {
                identity = getSharedPreferences("meet_native_calls", 0).getString("identity", "");
            }
            if (worker == null || worker.isShutdown()) {
                startForeground(SERVICE_ID, idleNotification());
                startPolling();
            }
            String room = intent.getStringExtra("room");
            if (ACTION_DECLINE.equals(action)) dismissCall(room);
            else clearIncoming();
            respond(room, ACTION_ACCEPT.equals(action));
            return START_STICKY;
        }
        if (intent != null) identity = intent.getStringExtra("identity");
        suppressedRoom = getSharedPreferences("meet_native_calls", 0).getString("dismissed_room", "");
        if (identity == null || identity.isEmpty()) {
            identity = getSharedPreferences("meet_native_calls", 0).getString("identity", "");
        } else {
            getSharedPreferences("meet_native_calls", 0).edit().putString("identity", identity).apply();
        }
        startForeground(SERVICE_ID, idleNotification());
        startPolling();
        return START_STICKY;
    }

    private void createChannels() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || Build.VERSION.SDK_INT < 26) return;
        NotificationChannel idle = new NotificationChannel(IDLE_CHANNEL, "Meet call listener", NotificationManager.IMPORTANCE_LOW);
        idle.setDescription("Background connection used to receive Meet calls");
        idle.setSound(null, null);
        manager.createNotificationChannel(idle);
        NotificationChannel calls = new NotificationChannel(CALL_CHANNEL, "Incoming Meet calls", NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("Ringing alerts for incoming Meet calls");
        calls.setSound(null, null);
        calls.enableVibration(true);
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(calls);
    }

    private Notification idleNotification() {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 10, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, CallListenerService.class).setAction(ACTION_STOP);
        PendingIntent stopAction = PendingIntent.getService(this, 11, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, IDLE_CHANNEL)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle("Meet is ready for calls")
            .setContentText("Listening for incoming calls")
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(tap)
            .setOngoing(false)
            .setAutoCancel(false)
            .addAction(android.R.drawable.ic_media_pause, "Stop listening", stopAction)
            .build();
    }

    private void startPolling() {
        if (worker != null && !worker.isShutdown()) return;
        worker = Executors.newSingleThreadScheduledExecutor();
        worker.scheduleWithFixedDelay(this::checkCalls, 0, 3, TimeUnit.SECONDS);
    }

    private void checkCalls() {
        if (identity == null || identity.isEmpty()) return;
        HttpURLConnection connection = null;
        try {
            String url = BASE_URL + "/api/call?type=incoming&identity=" + URLEncoder.encode(identity, "UTF-8");
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(7000);
            connection.setUseCaches(false);
            int status = connection.getResponseCode();
            if (status != 200) return;
            String body = readAll(connection.getInputStream());
            JSONArray calls = new JSONObject(body).optJSONArray("calls");
            if (calls == null || calls.length() == 0) {
                suppressedRoom = "";
                getSharedPreferences("meet_native_calls", 0).edit().remove("dismissed_room").apply();
                if (!activeRoom.isEmpty()) clearIncoming();
                return;
            }

            JSONObject nextCall = null;
            boolean suppressedStillRinging = false;
            for (int i = 0; i < calls.length(); i++) {
                JSONObject candidate = calls.optJSONObject(i);
                if (candidate == null) continue;
                String candidateRoom = candidate.optString("room", "");
                if (candidateRoom.isEmpty()) continue;
                if (candidateRoom.equals(suppressedRoom)) {
                    suppressedStillRinging = true;
                    continue;
                }
                if (nextCall == null) nextCall = candidate;
            }

            if (!suppressedStillRinging && !suppressedRoom.isEmpty()) {
                suppressedRoom = "";
                getSharedPreferences("meet_native_calls", 0).edit().remove("dismissed_room").apply();
            }
            if (nextCall == null) {
                if (!activeRoom.isEmpty()) clearIncoming();
                return;
            }

            String room = nextCall.optString("room", "");
            String caller = nextCall.optString("caller", "Someone");
            if (room.isEmpty()) return;
            if (!room.equals(activeRoom)) {
                activeRoom = room;
                activeCaller = caller;
                startRingtone();
                showIncomingNotification();
            }
        } catch (Exception ignored) {
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String readAll(InputStream input) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer)) != -1) out.write(buffer, 0, count);
        return out.toString("UTF-8");
    }

    private void startRingtone() {
        stopRingtone();
        try {
            ringtone = MediaPlayer.create(this, R.raw.meet_ringtone);
            if (ringtone != null) {
                ringtone.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build());
                ringtone.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
                ringtone.setLooping(true);
                ringtone.start();
            }
        } catch (Exception ignored) { stopRingtone(); }
    }

    private void stopRingtone() {
        if (ringtone != null) {
            try { if (ringtone.isPlaying()) ringtone.stop(); ringtone.release(); } catch (Exception ignored) {}
            ringtone = null;
        }
    }

    private void showIncomingNotification() {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 20, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent accept = new Intent(this, CallListenerService.class).setAction(ACTION_ACCEPT).putExtra("room", activeRoom);
        Intent decline = new Intent(this, CallListenerService.class).setAction(ACTION_DECLINE).putExtra("room", activeRoom);
        PendingIntent acceptAction = PendingIntent.getService(this, 21, accept, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent declineAction = PendingIntent.getService(this, 22, decline, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent fullScreen = new Intent(this, IncomingCallActivity.class)
            .putExtra("room", activeRoom).putExtra("caller", activeCaller)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent fullScreenAction = PendingIntent.getActivity(this, 23, fullScreen, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(this, CALL_CHANNEL)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(activeCaller + " is calling")
            .setContentText("Incoming Meet call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(tap)
            .setFullScreenIntent(fullScreenAction, true)
            .setOnlyAlertOnce(true)
            .setOngoing(false)
            .setAutoCancel(false)
            .addAction(android.R.drawable.sym_action_call, "Accept", acceptAction)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declineAction)
            .build();
        getSystemService(NotificationManager.class).notify(CALL_ID, notification);
    }

    private void respond(String room, boolean accept) {
        if (room == null || room.isEmpty()) return;
        String currentIdentity = identity;
        if (worker != null) worker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(BASE_URL + "/api/call").openConnection();
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setConnectTimeout(7000);
                connection.setReadTimeout(7000);
                connection.setRequestProperty("Content-Type", "application/json");
                JSONObject body = new JSONObject();
                body.put("action", "respond");
                body.put("room", room);
                body.put("identity", currentIdentity);
                body.put("accept", accept);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
                if (connection.getResponseCode() >= 200 && connection.getResponseCode() < 300) {
                    if (accept) getSharedPreferences("meet_native_calls", 0).edit().putString("pending_room", room).apply();
                    handler.post(() -> {
                        clearIncoming();
                        if (accept) {
                            Intent launch = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                            startActivity(launch);
                        }
                    });
                }
            } catch (Exception ignored) {
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private void dismissCall(String room) {
        if (room == null || room.isEmpty()) return;
        suppressedRoom = room;
        getSharedPreferences("meet_native_calls", 0).edit().putString("dismissed_room", room).apply();
        if (room.equals(activeRoom)) clearIncoming();
    }

    private void clearIncoming() {
        activeRoom = "";
        activeCaller = "";
        stopRingtone();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(CALL_ID);
    }

    private void stopListener() {
        stopRingtone();
        if (worker != null) { worker.shutdownNow(); worker = null; }
        stopForeground(true);
        stopSelf();
    }

    @Override public void onDestroy() {
        stopRingtone();
        if (worker != null) worker.shutdownNow();
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
