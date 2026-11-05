!include "nsDialogs.nsh"

!define MD_ASSOC_KEY "Software\Mardikor\FileAssociations"
!define MD_PROGID "Mardikor.Markdown"
!ifndef BUILD_UNINSTALLER
  Var MarkdownAssociation
  Var MarkdownCheckbox
!endif

!macro customInit
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
  !insertmacro UPDATEFILEASSOC
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro RemoveMarkdownAssociation
    DeleteRegKey SHELL_CONTEXT "${MD_ASSOC_KEY}"
    !insertmacro UPDATEFILEASSOC
  ${EndIf}
!macroend
