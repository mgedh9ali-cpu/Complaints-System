; Refresh only this application's shortcuts after its files are installed.
!macro customInstall
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ; The first launch must use the installed executable, never an older shortcut.
  StrCpy $launchLink "$appExe"
!macroend
