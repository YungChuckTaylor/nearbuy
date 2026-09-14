# Keep the JS bridge methods (they are called from JavaScript by name).
-keepclassmembers class app.nearbuygoods.android.MainActivity$NBGBridge {
    @android.webkit.JavascriptInterface <methods>;
}
