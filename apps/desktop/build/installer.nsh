; Opens the firewall for Mirror Studio on private and domain networks only (never public).
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mirror Studio"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mirror Studio" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private,domain'
!macroend
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mirror Studio"'
!macroend
