package app.nearbuygoods.android;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * NearBuyGoods Android shell — one Activity, zero external libraries.
 *
 * What it does:
 *  - Serves the bundled PWA (assets/www, a copy of /public) from a private,
 *    secure origin: https://app.nearbuygoods.local  (ES modules, localStorage,
 *    camera and GPS all require a secure context — file:///android_asset would
 *    not work).
 *  - Lets the user point the app at ANY NearBuyGoods API server: first-run
 *    dialog, later Profile → "App server address" (NBGBridge.changeServer()).
 *    The address is injected as ?api=… and persisted by public/js/config.js.
 *  - Bridges what WebView cannot do alone: runtime permissions for camera
 *    (getUserMedia barcode/photo flows) and geolocation, the native file
 *    picker for <input type="file">, Downloads saving for the GDPR export,
 *    and hand-off of external links to the browser.
 *
 * Roadmap (docs/ANDROID.md): FCM background push, ML Kit barcode, TWA upgrade
 * once the shop is on a verified HTTPS domain, in-app updates.
 */
public class MainActivity extends Activity {

    static final String TAG = "NearBuyGoods";
    static final String APP_HOST = "app.nearbuygoods.local";
    static final String APP_ORIGIN = "https://" + APP_HOST;
    static final String PREFS = "nbg_prefs";
    static final String KEY_API = "api_base";
    static final String UA_SUFFIX = " NBGAndroid/1.1.1";

    static final int REQ_CAMERA = 1001;
    static final int REQ_LOCATION = 1002;
    static final int REQ_FILE = 1003;
    static final int REQ_STORAGE = 1004;

    WebView webView;
    ProgressBar progress;
    SharedPreferences prefs;

    // Pending native-permission handshakes
    PermissionRequest pendingWebPermission;   // page asked for camera
    GeolocationPermissions.Callback pendingGeo;
    String pendingGeoOrigin;
    ValueCallback<Uri[]> pendingFileCallback; // <input type=file>
    String pendingSaveName;                   // saveText() waiting on WRITE permission (API ≤ 28)
    String pendingSaveText;

    static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("gif", "image/gif");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("txt", "text/plain");
    }

    /* ---------------------------------------------------------------- lifecycle */

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        root.addView(progress, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        setContentView(root);
        configureWebView();

        if (savedInstanceState != null && webView.restoreState(savedInstanceState) != null) {
            return; // rotation/process-death: WebView restored itself
        }
        if (!prefs.contains(KEY_API)) showServerDialog(true);
        else loadApp();
    }

    @Override protected void onResume() { super.onResume(); webView.onResume(); }
    @Override protected void onPause() { webView.onPause(); super.onPause(); }
    @Override protected void onDestroy() { if (webView != null) webView.destroy(); super.onDestroy(); }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        webView.saveState(out);
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    /* ---------------------------------------------------------------- webview setup */

    void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Dev convenience: page origin is https (app host) but the API may be plain
        // http during LAN testing (http://192.168.x.x:3000). Production should use HTTPS.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + UA_SUFFIX);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!APP_HOST.equals(url.getHost())) return null; // real network: API host etc.
                return serveAsset(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String host = url.getHost() == null ? "" : url.getHost();
                if (APP_HOST.equals(host)) return false;   // app shell: stay inside
                if (isApiHost(host)) return false;         // API pages (sim checkout, /api/docs): keep in-app so flows return to the shell
                openExternal(url.toString());              // everything else (real Paystack checkout, tel:, mailto:, geo:…) → other apps
                return true;
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); // never bypass a bad certificate
                toast("SSL error contacting " + error.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                progress.setProgress(p);
                progress.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                boolean wantsCamera = false;
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
                }
                if (!wantsCamera) { request.deny(); return; }
                pendingWebPermission = request;
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    grantWebPermission();
                } else {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                }
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }
                pendingGeo = callback;
                pendingGeoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(firstAcceptType(params.getAcceptTypes()));
                try {
                    startActivityForResult(Intent.createChooser(intent, "Choose a file"), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingFileCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        webView.addJavascriptInterface(new NBGBridge(), "NBGBridge");
    }

    /** Serves a request for the app host out of assets/www, with SPA + 404 fallbacks. */
    WebResourceResponse serveAsset(Uri url) {
        String path = url.getPath();
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        String ext = path.contains(".") ? path.substring(path.lastIndexOf('.') + 1).toLowerCase() : "";
        try {
            InputStream is = getAssets().open("www" + path);
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            return new WebResourceResponse(mime, "utf-8", is);
        } catch (IOException notFound) {
            if (ext.isEmpty()) { // extension-less client route → SPA shell
                try {
                    return new WebResourceResponse("text/html", "utf-8", getAssets().open("www/index.html"));
                } catch (IOException ignored) { /* fall through to 404 */ }
            }
            WebResourceResponse r = new WebResourceResponse("application/json", "utf-8",
                    new ByteArrayInputStream("{\"error\":\"not found\"}".getBytes(StandardCharsets.UTF_8)));
            r.setStatusCodeAndReasonPhrase(404, "Not Found");
            return r;
        }
    }

    String firstAcceptType(String[] acceptTypes) {
        if (acceptTypes != null) {
            for (String t : acceptTypes) {
                if (t == null) continue;
                String tt = t.trim().toLowerCase();
                if (tt.startsWith("image/")) return "image/*";
                if (!tt.isEmpty() && !tt.equals(".")) return tt;
            }
        }
        return "*/*";
    }

    /* ---------------------------------------------------------------- permission results */

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        switch (requestCode) {
            case REQ_CAMERA:
                if (granted) grantWebPermission();
                else if (pendingWebPermission != null) { pendingWebPermission.deny(); pendingWebPermission = null; }
                break;
            case REQ_LOCATION:
                if (pendingGeo != null) { pendingGeo.invoke(pendingGeoOrigin, granted, false); pendingGeo = null; }
                break;
            case REQ_STORAGE:
                if (granted && pendingSaveText != null) {
                    String n = pendingSaveName, t = pendingSaveText;
                    pendingSaveName = null; pendingSaveText = null;
                    saveTextNow(n, t);
                } else {
                    pendingSaveName = null; pendingSaveText = null;
                    toast("Storage permission denied — export not saved");
                }
                break;
        }
    }

    void grantWebPermission() {
        if (pendingWebPermission == null) return;
        pendingWebPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        pendingWebPermission = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || pendingFileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getDataString() != null) {
            result = new Uri[]{Uri.parse(data.getDataString())};
        }
        pendingFileCallback.onReceiveValue(result); // null on cancel — required, or the input dies
        pendingFileCallback = null;
    }

    /* ---------------------------------------------------------------- server address */

    void loadApp() {
        String api = prefs.getString(KEY_API, "");
        String url = APP_ORIGIN + "/index.html";
        if (!api.isEmpty()) url += "?api=" + Uri.encode(api);
        webView.loadUrl(url);
    }

    boolean isApiHost(String host) {
        String api = prefs.getString(KEY_API, "");
        if (api.isEmpty() || host == null) return false;
        String apiHost = Uri.parse(api).getHost();
        return apiHost != null && apiHost.equalsIgnoreCase(host);
    }

    void showServerDialog(final boolean firstRun) {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint("https://shop.yourdomain.com");
        input.setText(prefs.getString(KEY_API, ""));
        FrameLayout box = new FrameLayout(this);
        box.setPadding(dp(20), dp(8), dp(20), 0);
        box.addView(input);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(firstRun ? "Connect your NearBuyGoods server" : "App server address")
                .setMessage("Where does the NearBuyGoods API run?\n\n"
                        + "• Production: your https:// domain\n"
                        + "• Testing over Wi‑Fi: http://<computer-ip>:3000\n\n"
                        + "You can change this later under Profile → App server address.")
                .setView(box)
                .setCancelable(false)
                .setPositiveButton("Connect", (d, w) -> {
                    String base = normalizeBase(input.getText().toString());
                    if (base == null) {
                        toast("That doesn't look like a valid address");
                        showServerDialog(firstRun);
                        return;
                    }
                    prefs.edit().putString(KEY_API, base).apply();
                    loadApp();
                })
                .setNegativeButton(firstRun ? "Skip for now" : "Cancel", (d, w) -> {
                    if (firstRun) { prefs.edit().putString(KEY_API, "").apply(); loadApp(); }
                })
                .create();
        dialog.setCanceledOnTouchOutside(false);
        dialog.show();
    }

    /** "" = run without a server (configurable later). null = invalid input. */
    String normalizeBase(String in) {
        String v = in == null ? "" : in.trim();
        if (v.isEmpty()) return "";
        if (!v.startsWith("http://") && !v.startsWith("https://")) v = "https://" + v;
        while (v.endsWith("/")) v = v.substring(0, v.length() - 1);
        Uri u = Uri.parse(v);
        if (u.getHost() == null || u.getHost().isEmpty()) return null;
        return v;
    }

    /* ---------------------------------------------------------------- misc helpers */

    void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException e) {
            toast("No app available to open this link");
        }
    }

    void toast(final String m) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, m, Toast.LENGTH_SHORT).show());
    }

    /* ---------------------------------------------------------------- JS bridge */

    /** Exposed to the PWA as window.NBGBridge — its presence is how JS detects
     *  it is inside the native wrapper (push off, server row on, downloads via native). */
    class NBGBridge {
        @JavascriptInterface
        public boolean isNative() { return true; }

        @JavascriptInterface
        public String getApiBase() { return prefs.getString(KEY_API, ""); }

        @JavascriptInterface
        public void changeServer() { runOnUiThread(() -> showServerDialog(false)); }

        @JavascriptInterface
        public void saveText(final String filename, final String text) {
            if (Build.VERSION.SDK_INT < 29
                    && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                pendingSaveName = filename;
                pendingSaveText = text;
                runOnUiThread(() -> requestPermissions(
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE));
                return;
            }
            saveTextNow(filename, text);
        }
    }

    void saveTextNow(final String filename, final String text) {
        new Thread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/NearBuyGoods");
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) throw new IOException("MediaStore insert failed");
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os == null) throw new IOException("cannot open output");
                        os.write(text.getBytes(StandardCharsets.UTF_8));
                    }
                    cv.clear();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, cv, null, null);
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS), "NearBuyGoods");
                    if (!dir.exists() && !dir.mkdirs()) throw new IOException("cannot create Downloads/NearBuyGoods");
                    try (FileOutputStream fo = new FileOutputStream(new File(dir, filename))) {
                        fo.write(text.getBytes(StandardCharsets.UTF_8));
                    }
                }
                toast("Saved to Downloads/NearBuyGoods/" + filename);
            } catch (Exception e) {
                Log.e(TAG, "saveText failed", e);
                toast("Save failed: " + e.getMessage());
            }
        }).start();
    }
}
