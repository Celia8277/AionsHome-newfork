package com.ysclaude.app;
import android.os.Bundle;
interface IShizukuShellService {
  Bundle execute(String command, long timeoutMs, int maxOutputChars);
  void destroy();
}
