package com.meet.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class IncomingCallActivity extends Activity {
    private String room = "";
    private String caller = "Someone";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        readCall(getIntent());
        render();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readCall(intent);
        render();
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );
    }

    private void readCall(Intent intent) {
        if (intent == null) return;
        room = intent.getStringExtra("room") == null ? "" : intent.getStringExtra("room");
        caller = intent.getStringExtra("caller") == null ? "Someone" : intent.getStringExtra("caller");
    }

    private int dp(float value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private TextView label(String text, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setGravity(Gravity.CENTER);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private void render() {
        int white = Color.WHITE;
        int muted = Color.rgb(191, 202, 224);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(36), dp(28), dp(36));
        root.setBackgroundColor(Color.rgb(12, 20, 39));

        TextView brand = label("CONVO", 14, Color.rgb(117, 164, 255), true);
        root.addView(brand, new LinearLayout.LayoutParams(-1, dp(34)));

        TextView avatar = label(caller.isEmpty() ? "?" : caller.substring(0, 1).toUpperCase(), 42, white, true);
        avatar.setBackgroundColor(Color.rgb(49, 83, 145));
        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(104), dp(104));
        avatarParams.gravity = Gravity.CENTER;
        avatarParams.topMargin = dp(48);
        avatarParams.bottomMargin = dp(26);
        root.addView(avatar, avatarParams);

        root.addView(label("INCOMING VIDEO CALL", 13, muted, true), new LinearLayout.LayoutParams(-1, dp(30)));
        TextView name = label(caller, 30, white, true);
        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(-1, dp(54));
        nameParams.topMargin = dp(8);
        root.addView(name, nameParams);
        root.addView(label("is calling you", 16, muted, false), new LinearLayout.LayoutParams(-1, dp(34)));

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.CENTER);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams actionsParams = new LinearLayout.LayoutParams(-1, dp(64));
        actionsParams.topMargin = dp(64);

        Button decline = new Button(this);
        decline.setText("Decline");
        decline.setTextColor(white);
        decline.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(184, 55, 75)));
        Button accept = new Button(this);
        accept.setText("Accept");
        accept.setTextColor(white);
        accept.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(27, 151, 105)));

        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(0, dp(58), 1);
        buttonParams.setMargins(dp(6), 0, dp(6), 0);
        actions.addView(decline, buttonParams);
        actions.addView(accept, buttonParams);
        root.addView(actions, actionsParams);

        decline.setOnClickListener(v -> respond(false));
        accept.setOnClickListener(v -> respond(true));

        setContentView(root);
    }

    private void respond(boolean accept) {
        if (room.isEmpty()) {
            finish();
            return;
        }
        Intent action = new Intent(this, CallListenerService.class)
            .setAction(accept ? CallListenerService.ACTION_ACCEPT : CallListenerService.ACTION_DECLINE)
            .putExtra("room", room);
        startService(action);
        finish();
    }
}