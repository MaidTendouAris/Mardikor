!include "nsDialogs.nsh"
!include "${PROJECT_DIR}\build-scripts\shellnew.nsh"

LangString NewMarkdownDocument 1033 "Markdown Document"
LangString NewMarkdownDocument 2052 "Markdown 文档"
LangString NewMdkProject 1033 "MDK Project"
LangString NewMdkProject 2052 "MDK 工程"

!define MD_ASSOC_KEY "Software\Mardikor\FileAssociations"
!define MD_PROGID "Mardikor.Markdown"
!ifndef BUILD_UNINSTALLER
  Var MarkdownAssociation
  Var MarkdownCheckbox
!endif

!macro customInit
  ${If} ${isUpdated}
    # Older app versions pass --updated without /S.
    SetSilent silent
    !ifndef INSTALL_MODE_PER_ALL_USERS
      !ifndef ONE_CLICK
        ${If} $hasPerUserInstallation == "1"
        ${AndIf} $hasPerMachineInstallation == "1"
          ReadEnvStr $0 "MARDIKOR_UPDATE_INSTALL_DIR"
          ${If} $0 == $perMachineInstallationFolder
          ${OrIf} ${UAC_IsInnerInstance}
            !insertmacro setInstallModePerAllUsers
          ${Else}
            # Keep the per-user selection made by initMultiUser. Otherwise the
            # assisted installer promotes any silent update to machine scope.
            StrCpy $hasPerMachineInstallation "0"
          ${EndIf}
        ${EndIf}
      !endif
    !endif
  ${EndIf}
  ReadRegDWORD $MarkdownAssociation SHELL_CONTEXT "${MD_ASSOC_KEY}" "Markdown"
  ${If} $MarkdownAssociation != 1
    StrCpy $MarkdownAssociation 0
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom MarkdownAssociationPage MarkdownAssociationLeave

  Function MarkdownAssociationPage
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "文件关联" "选择需要使用 Mardikor 打开的文件类型。"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 28u ".mdk 工程文件将自动与 Mardikor 关联。"
    Pop $0
    ${NSD_CreateCheckbox} 0 36u 100% 16u "将 .md（Markdown）文件与 Mardikor 关联"
    Pop $MarkdownCheckbox
    ${If} $MarkdownAssociation == 1
      ${NSD_Check} $MarkdownCheckbox
    ${Else}
      ${NSD_Uncheck} $MarkdownCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 0 62u 100% 36u "不勾选时保留现有 Markdown 打开方式。首次安装默认不勾选。"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function MarkdownAssociationLeave
    ${NSD_GetState} $MarkdownCheckbox $MarkdownAssociation
  FunctionEnd
!macroend

!macro RemoveMarkdownAssociation
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.md" ""
  ${If} $0 == "${MD_PROGID}"
    ReadRegStr $1 SHELL_CONTEXT "${MD_ASSOC_KEY}" "PreviousMarkdown"
    ${If} $1 == ""
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.md" ""
    ${Else}
      WriteRegStr SHELL_CONTEXT "Software\Classes\.md" "" "$1"
    ${EndIf}
  ${EndIf}
  !insertmacro APP_UNASSOCIATE "md" "${MD_PROGID}"
!macroend

!macro customInstall
  Push $OUTDIR
  SetOutPath "$INSTDIR\bin"
  File "${PROJECT_DIR}\build-output\cli\mardikor.exe"
  File "${PROJECT_DIR}\build-output\cli\package\bin\mardikor.cjs"
  Pop $2
  SetOutPath "$INSTDIR\resources\shellnew"
  File "${PROJECT_DIR}\build-output\shellnew\Blank.mdk"
  SetOutPath "$2"
  nsExec::ExecToStack '"$INSTDIR\bin\mardikor.exe" --register-path "$installMode"'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    DetailPrint "CLI PATH registration failed: $1"
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法注册 mardikor 命令。可在安装目录的 bin 文件夹直接运行 mardikor.exe。$\r$\n$1" /SD IDOK
  ${EndIf}
  ${If} $MarkdownAssociation == 1
    ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.md" ""
    ${If} $0 != "${MD_PROGID}"
      WriteRegStr SHELL_CONTEXT "${MD_ASSOC_KEY}" "PreviousMarkdown" "$0"
    ${EndIf}
    !insertmacro APP_ASSOCIATE "md" "${MD_PROGID}" "Markdown document" "$INSTDIR\resources\icons\markdown.ico,0" "Open with Mardikor" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  ${Else}
    !insertmacro RemoveMarkdownAssociation
  ${EndIf}
  WriteRegDWORD SHELL_CONTEXT "${MD_ASSOC_KEY}" "Markdown" $MarkdownAssociation
  # A previously unregistered extension needs a file type for Explorer's New
  # menu. This fallback contains a description only, with no open command.
  ReadRegStr $0 HKCR ".md" ""
  ${If} $0 == ""
    WriteRegStr SHELL_CONTEXT "${SHELLNEW_CLASSES}\.md" "" "${MARKDOWN_FILE_TYPE}"
    WriteRegStr SHELL_CONTEXT "${SHELLNEW_CLASSES}\${MARKDOWN_FILE_TYPE}" "" "$(NewMarkdownDocument)"
  ${EndIf}
  !insertmacro RegisterShellNew "md" "NullFile" "" "$(NewMarkdownDocument)" "markdown.ico"
  !insertmacro EnsureMarkdownShellNewTypeName "$(NewMarkdownDocument)"
  !insertmacro RegisterShellNew "mdk" "FileName" "$INSTDIR\resources\shellnew\Blank.mdk" "$(NewMdkProject)" "mdk-default.ico"
  !insertmacro UPDATEFILEASSOC
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    ${If} ${FileExists} "$INSTDIR\bin\mardikor.exe"
      nsExec::ExecToStack '"$INSTDIR\bin\mardikor.exe" --unregister-path "$installMode"'
      Pop $0
      Pop $1
      ${If} $0 != "0"
        DetailPrint "CLI PATH removal failed: $1"
      ${EndIf}
    ${EndIf}
    !insertmacro RemoveMarkdownAssociation
    !insertmacro RemoveShellNew "md" "NullFile" "" "markdown.ico"
    ReadRegStr $0 HKCR ".md\ShellNew" "MardikorInstallDir"
    ${If} $0 == ""
      !insertmacro RestoreMarkdownShellNewTypeName
    ${EndIf}
    !insertmacro RemoveShellNew "mdk" "FileName" "$INSTDIR\resources\shellnew\Blank.mdk" "mdk-default.ico"
    ReadRegStr $0 SHELL_CONTEXT "${SHELLNEW_CLASSES}\.md" ""
    ${If} $0 == "${MARKDOWN_FILE_TYPE}"
      DeleteRegValue SHELL_CONTEXT "${SHELLNEW_CLASSES}\.md" ""
    ${EndIf}
    DeleteRegValue SHELL_CONTEXT "${SHELLNEW_CLASSES}\${MARKDOWN_FILE_TYPE}" ""
    DeleteRegKey /ifempty SHELL_CONTEXT "${SHELLNEW_CLASSES}\${MARKDOWN_FILE_TYPE}"
    DeleteRegKey /ifempty SHELL_CONTEXT "${SHELLNEW_CLASSES}\.md"
    DeleteRegKey SHELL_CONTEXT "${MD_ASSOC_KEY}"
    !insertmacro UPDATEFILEASSOC
  ${EndIf}
!macroend
