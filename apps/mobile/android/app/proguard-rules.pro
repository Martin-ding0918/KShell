# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see:
#   http://developer.android.com/guide/developing/tools/proguard.html

# App-native modules are tiny and bridge via annotation reflection; keeping
# them unminified costs nothing meaningful and removes a whole risk class.
# (RN/react-android and other AARs ship their own consumer rules.)
-keep class com.zshell.** { *; }

# tink-android (pulled in by react-native-mmkv-storage) references this
# compile-only annotation on method signatures; the annotations jar used to
# arrive transitively via the MLKit face-detection dependency that the
# camera patch strips. Safe to ignore at runtime.
-dontwarn com.google.errorprone.annotations.Immutable
