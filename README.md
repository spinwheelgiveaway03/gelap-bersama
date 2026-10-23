# GELAP BERSAMA

3D Multiplayer Survival Horror Online Co-op (1–4 pemain)

## Fitur yang berfungsi

- Backend Node.js + Socket.IO (Room ID otomatis, Join, Quick Join)
- Client Three.js FPP
- Model humanoid sederhana teman terlihat di dunia 3D
- Sync posisi / rotasi
- Jumpscare timer 5 detik + serangan pisau (server validated)
- Knock 60 detik + Revive (tahan 5 detik)
- Spectator mode
- WebRTC voice chat signaling (STUN Google; untuk production tambah TURN)
- Kontrol PC (WASD + mouse) & Android (joystick + tombol)
- Menu: Solo / Buat Room / Join / Quick Join

## Cara menjalankan (lokal)

```bash
npm install
npm start
```

Buka browser: **http://localhost:3000**

Uji multiplayer: buka 2–4 tab browser, buat room di satu tab, join dengan Room ID di tab lain.

### Kontrol PC
- WASD = gerak
- Mouse = lihat (klik canvas dulu)
- Shift = lari
- F = senter
- Klik kiri = pisau
- J = uji jumpscare (debug)
- E = mulai revive (dekat teman yang KO)
- C = jongkok

### Kontrol Android / touch
- Joystick kiri = gerak
- Geser kanan layar = kamera
- Tombol F / PISAU / MIC / TOLONG

## Deploy server online

1. Push ke GitHub
2. Deploy ke Railway / Render / Fly.io sebagai Node service
3. Set environment `PORT` (otomatis di kebanyakan platform)
4. Ganti URL Socket.IO di client jika perlu (atau biarkan relative)
5. Untuk voice chat stabil di jaringan berbeda, tambahkan TURN server (Metered.ca / coturn)

## Build APK (Capacitor)

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Gelap Bersama" "com.gelapbersama.app" --web-dir public
npx cap add android
```

Tambah permission di `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

Lalu:

```bash
npx cap sync android
npx cap open android
```

Build APK debug dari Android Studio.

## Catatan jujur

- Ini fondasi multiplayer yang **nyata** (bukan mockup).
- Model karakter masih sederhana (capsule + kepala).
- Map masih koridor rumah sakit minimal.
- Voice chat butuh TURN untuk NAT ketat.
- AI hantu masih patroli sederhana.
- APK belum di-build di environment ini; ikuti langkah Capacitor di atas.

Prioritaskan: deploy server → uji 2 device beda jaringan → tambah TURN → lanjut map & AI.
