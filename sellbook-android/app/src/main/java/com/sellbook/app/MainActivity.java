package com.sellbook.app;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;
    private static final String APP_URL = "https://my-sales-book.vercel.app/?native=1";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(20, 83, 45));
        getWindow().setNavigationBarColor(Color.rgb(20, 83, 45));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(243, 246, 243));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if ("sellbook".equals(uri.getScheme()) && "auth".equals(uri.getHost())) {
                    handleAuthCallback(uri);
                    return true;
                }
                if (url.contains("/auth/v1/authorize") && url.contains("provider=google")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) { }
                    return true;
                }
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        setContentView(webView);
        if (getIntent() != null && getIntent().getData() != null &&
                "sellbook".equals(getIntent().getData().getScheme())) {
            handleAuthCallback(getIntent().getData());
        } else if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    private void handleAuthCallback(Uri uri) {
        String code = uri.getQueryParameter("code");
        String error = uri.getQueryParameter("error_description");
        if (code != null && !code.isEmpty()) {
            webView.loadUrl("https://my-sales-book.vercel.app/?native=1&code=" + Uri.encode(code));
        } else if (error != null) {
            webView.loadUrl(APP_URL);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (data != null && "sellbook".equals(data.getScheme()) && webView != null) {
            handleAuthCallback(data);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}