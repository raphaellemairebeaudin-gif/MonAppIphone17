      const choose=async folderId=>{
        const cats=db.all('note_category').filter(c=>c.data.folderId===folderId);
        const categoryPicker=h('select',{},
          h('option',{value:''},'Sans catégorie'),
          ...cats.map(c=>h('option',{value:c.id},c.data.title)));
        sheet('Choisir une catégorie', closeCategory=>h('div',{},
          field('Catégorie',categoryPicker),
          h('button',{class:'btn primary',onclick:async()=>{
            data.folderId=folderId;
            data.categoryId=categoryPicker.value||null;
            changed();
            await flush();
            closeCategory();close();toast('Note ajoutée au dossier.');
          }},'Ajouter au dossier')));
      };
      const choose=async folderId=>{
        data.folderId=folderId;
        data.categoryId=null;
        changed();
        await flush();
        close();
        toast('Note ajoutée au dossier.');
      };
      list.replaceChildren(
        ...db.all('note_folder').map(f=>h('button',{class:'notes-folder-picker-row',onclick:()=>choose(f.id)},
          icon(f.data.icon||'folder'),h('span',{},f.data.title),icon('chevron-right'))),
        h('button',{class:'notes-folder-picker-row',onclick:()=>editFolder(null,async created=>{
          data.folderId=created.id;
          data.categoryId=null;
          changed();
          await flush();
          close();
          toast('Dossier créé et note ajoutée.');
        })},icon('folder-plus'),h('span',{},'Créer un nouveau dossier'),icon('plus')),
        data.folderId ? h('button',{class:'notes-folder-picker-row',onclick:async()=>{
          data.folderId=null;data.categoryId=null;changed();await flush();close();toast('Note retirée du dossier.');
        }},icon('folder-minus'),h('span',{},'Retirer du dossier')) : null);
      return list;
    });
  }
  function drawActions() {
    ctx.setActions([
      h('button',{class:'icon-btn',type:'button','aria-label':'Options de la note',onclick:()=>{
        sheet('Options de la note',close=>h('div',{class:'notes-options'},
          h('button',{class:'notes-option-row',onclick:()=>{
            data.pinned=!data.pinned;changed();flush();drawActions();close();
            toast(data.pinned?'Note épinglée':'Note désépinglée');
          }},icon('pin'),data.pinned?'Désépingler':'Épingler'),
          h('button',{class:'notes-option-row',onclick:()=>{close();openFolderPicker();}},
            icon('folder-plus'),'Ajouter au dossier'),
          record ? h('button',{class:'notes-option-row danger',onclick:async()=>{
            if(!confirm('Supprimer cette note ?'))return;
            try{deleted=true;clearTimeout(timer);await chain;await db.remove(record.id);close();location.hash=backTo;}
            catch(e){deleted=false;toast(errMsg(e));}
          }},icon('trash'),'Supprimer') : null
        ));
      }},icon('dots'))
    ]);
  }

  ctx.main.classList.add('note-editing-host');
  ctx.main.append(titleIn, editable, status, toolbar, sizeMenu, caretHint);
  ctx.onLeave(() => {
    closeSizeMenu();
    ctx.main.classList.remove('note-editing-host');
    if (timer) flush();
    cancelAnimationFrame(keyboardFrame);
    cancelAnimationFrame(hintFrame);
    document.removeEventListener('visibilitychange', onAppVisibility);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('selectionchange', scheduleCaretHint);
    window.removeEventListener('scroll', scheduleCaretHint, true);
    window.visualViewport?.removeEventListener('scroll', scheduleCaretHint);
    window.visualViewport?.removeEventListener('resize', scheduleCaretHint);
    window.visualViewport?.removeEventListener('resize', positionToolbar);
    window.visualViewport?.removeEventListener('scroll', positionToolbar);
    window.removeEventListener('resize', positionToolbar);
    document.removeEventListener('selectionchange', updateToolStates);
    document.removeEventListener('selectionchange', rememberSelection);
  });
  drawActions();
  followKeyboard();
  if (!record) setTimeout(() => titleIn.focus(), 50);
}
