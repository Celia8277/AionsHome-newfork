package com.ysclaude.app

import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class IncomingCallRingtoneModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null

  override fun getName(): String = "IncomingCallRingtone"

  @ReactMethod
  fun start(promise: Promise) {
    mainHandler.post {
      try {
        stopInternal()
        val uri = RingtoneManager.getActualDefaultRingtoneUri(
          reactContext, RingtoneManager.TYPE_RINGTONE
        ) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        if (uri == null) {
          promise.resolve(false)
          return@post
        }
        val next = MediaPlayer()
        player = next
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          next.setAudioAttributes(AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build())
        } else {
          @Suppress("DEPRECATION")
          next.setAudioStreamType(AudioManager.STREAM_RING)
        }
        next.isLooping = true
        next.setDataSource(reactContext, uri)
        next.prepare()
        next.start()
        promise.resolve(true)
      } catch (error: Exception) {
        stopInternal()
        promise.reject("INCOMING_CALL_RINGTONE", error)
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    mainHandler.post {
      stopInternal()
      promise.resolve(true)
    }
  }

  private fun stopInternal() {
    val current = player
    player = null
    try { current?.stop() } catch (_: Exception) {}
    current?.release()
  }
}
