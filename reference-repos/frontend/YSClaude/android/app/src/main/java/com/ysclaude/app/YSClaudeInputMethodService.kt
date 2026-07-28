package com.ysclaude.app

import android.inputmethodservice.InputMethodService
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.TextView

class YSClaudeInputMethodService : InputMethodService() {
  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onDestroy() {
    if (instance === this) {
      instance = null
    }
    super.onDestroy()
  }

  override fun onCreateInputView(): View {
    return TextView(this).apply {
      text = "YSClaude IME active"
      textSize = 14f
      gravity = Gravity.CENTER
      minHeight = dp(48)
      setTextColor(0xFF3A373E.toInt())
      setBackgroundColor(0xFFF7F4FA.toInt())
    }
  }

  override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
    super.onStartInputView(info, restarting)
    instance = this
  }

  private fun commitTextInternal(text: String): Boolean {
    return currentInputConnection?.commitText(text, 1) == true
  }

  private fun performEditorActionInternal(action: String): Boolean {
    val actionId = when (action.lowercase()) {
      "go" -> EditorInfo.IME_ACTION_GO
      "search" -> EditorInfo.IME_ACTION_SEARCH
      "send" -> EditorInfo.IME_ACTION_SEND
      "next" -> EditorInfo.IME_ACTION_NEXT
      "done" -> EditorInfo.IME_ACTION_DONE
      else -> EditorInfo.IME_ACTION_UNSPECIFIED
    }
    return currentInputConnection?.performEditorAction(actionId) == true
  }

  private fun deleteSurroundingTextInternal(beforeLength: Int, afterLength: Int): Boolean {
    return currentInputConnection?.deleteSurroundingText(beforeLength.coerceAtLeast(0), afterLength.coerceAtLeast(0)) == true
  }

  private fun dp(value: Int): Int {
    return (value * resources.displayMetrics.density).toInt()
  }

  companion object {
    private const val MAX_COMMIT_TEXT_CHARS = 4000

    @Volatile
    private var instance: YSClaudeInputMethodService? = null

    fun isReady(): Boolean {
      return instance?.currentInputConnection != null
    }

    fun commitText(text: String): Pair<Boolean, String> {
      if (text.length > MAX_COMMIT_TEXT_CHARS) {
        return false to "Text is too long: ${text.length} > $MAX_COMMIT_TEXT_CHARS"
      }
      val service = instance ?: return false to "YSClaude IME is not active. Enable and switch to it first."
      val success = service.commitTextInternal(text)
      return success to if (success) "Text committed through YSClaude IME" else "No active input connection"
    }

    fun performEditorAction(action: String): Pair<Boolean, String> {
      val service = instance ?: return false to "YSClaude IME is not active. Enable and switch to it first."
      val success = service.performEditorActionInternal(action)
      return success to if (success) "Editor action performed: $action" else "Editor action failed: $action"
    }

    fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Pair<Boolean, String> {
      val service = instance ?: return false to "YSClaude IME is not active. Enable and switch to it first."
      val success = service.deleteSurroundingTextInternal(beforeLength, afterLength)
      return success to if (success) "Text deleted through YSClaude IME" else "Delete text failed"
    }
  }
}
