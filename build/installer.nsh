; Undo WormFiles' Windows integration when it's uninstalled (not when it's just being updated),
; so folders open in File Explorer again, Worm leaves the browser list and WormFiles leaves the media player list.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Classes\Directory\shell" ""
    StrCmp $0 "openinwormfiles" 0 +2
      DeleteRegValue HKCU "Software\Classes\Directory\shell" ""
    DeleteRegKey HKCU "Software\Classes\Directory\shell\openinwormfiles"

    ReadRegStr $0 HKCU "Software\Classes\Drive\shell" ""
    StrCmp $0 "openinwormfiles" 0 +2
      DeleteRegValue HKCU "Software\Classes\Drive\shell" ""
    DeleteRegKey HKCU "Software\Classes\Drive\shell\openinwormfiles"

    ReadRegStr $0 HKCU "Software\Classes\CLSID\{52205fd8-5dfb-447d-801a-d0b52f2e83e1}\shell\opennewwindow\command" "CreatedBy"
    StrCmp $0 "WormFiles" 0 +2
      DeleteRegKey HKCU "Software\Classes\CLSID\{52205fd8-5dfb-447d-801a-d0b52f2e83e1}"

    DeleteRegKey HKCU "Software\Clients\StartMenuInternet\WormFiles"
    DeleteRegValue HKCU "Software\RegisteredApplications" "WormFiles"
    DeleteRegKey HKCU "Software\Classes\WormFilesURL"
    DeleteRegKey HKCU "Software\Classes\WormFilesHTML"
    DeleteRegKey HKCU "Software\Classes\WormFilesMedia"
    DeleteRegKey HKCU "Software\WormFiles\Player"
    DeleteRegValue HKCU "Software\RegisteredApplications" "WormFilesPlayer"
    DeleteRegValue HKCU "Software\Classes\.mp4\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.m4v\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.webm\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.mov\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.mkv\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.ogv\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.mp3\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.wav\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.flac\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.ogg\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.oga\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.m4a\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.aac\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.opus\OpenWithProgids" "WormFilesMedia"
    DeleteRegValue HKCU "Software\Classes\.weba\OpenWithProgids" "WormFilesMedia"
  ${endIf}
!macroend
