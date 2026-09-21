/* IL MIO BAR - MIGLIORAMENTI UI */

var tableSearchText="";
var clientSearchText="";
var clientDebtFilter="all";
var lastRound={};

function norm(v){
 return String(v||"")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/\s+/g," ")
  .trim();
}


/* ---------- NAVIGAZIONE ---------- */

var baseRenderCurrent=renderCurrent;
renderCurrent=function(){
 if(!initialized)return;
 if(currentView==="tables")renderTables();
 else if(currentView==="table")renderTable();
 else if(currentView==="clients")renderClients();
 else if(currentView==="client")renderClientShell();
 else if(currentView==="history")renderHistory();
};

var baseOpenTable=openTable;
openTable=function(id){
 tableSearchText="";
 baseOpenTable(id);
};


/* ---------- RICERCA CLIENTE NEL TAVOLO ---------- */

function tableClientResults(){
 var box=document.getElementById("tableClientResults");
 var inp=document.getElementById("tableClientSearch");
 if(!box||!inp)return;

 tableSearchText=inp.value;
 var q=norm(tableSearchText);

 if(!q){
  box.innerHTML="";
  return;
 }

 var found=state.clients.filter(function(c){
  return norm(c.name).indexOf(q)>=0;
 }).slice(0,20);

 if(!found.length){
  box.innerHTML='<div class="small">Nessun cliente trovato.</div>';
  return;
 }

 box.innerHTML=found.map(function(c){
  return '<button type="button" style="display:block;width:100%;margin:6px 0;text-align:left" '+
   'onclick="chooseTableClient(\''+esc(c.id)+'\')">'+
   esc(c.name)+'</button>';
 }).join("");
}

async function chooseTableClient(cid){
 var t=getTable(currentTableId);
 var c=getClient(cid);
 if(!t||!c)return;

 try{
  await db.collection("tables")
   .doc(String(t._id||t.id))
   .update({activeClientId:String(c.id)});

  tableSearchText="";
 }catch(e){
  showMessage(friendlyError(e));
 }
}


/* ---------- RIPETI GIRO ---------- */

function roundKey(tid,cid){
 return String(tid)+"_"+String(cid);
}

function findLastRound(tid,cid){
 var key=roundKey(tid,cid);

 if(lastRound[key]&&lastRound[key].length){
  return lastRound[key].slice();
 }

 var all=tableItems(tid).slice().sort(function(a,b){
  return String(a.date||"").localeCompare(String(b.date||""));
 });

 var pos=-1;

 for(var i=all.length-1;i>=0;i--){
  if(same(all[i].clientId,cid)){
   pos=i;
   break;
  }
 }

 if(pos<0)return [];

 var values=[];

 for(var j=pos;j>=0;j--){
  if(!same(all[j].clientId,cid))break;

  var n=Number(all[j].amount||0);
  if(n>0)values.unshift(n);
 }

 lastRound[key]=values.slice();
 return values;
}

async function repeatRound(cid){
 var t=getTable(currentTableId);
 var c=getClient(cid);

 if(!t||!c)return;

 var values=findLastRound(t.id,c.id);

 if(!values.length){
  showMessage("Nessun giro da ripetere.");
  return;
 }

 var batch=db.batch();
 var total=0;
 var base=Date.now();

 values.forEach(function(amount,n){
  amount=Number(amount);
  if(!isFinite(amount)||amount<=0)return;

  var ref=db.collection("openItems").doc();
  var id=ref.id;
  var date=new Date(base+n).toISOString();

  total+=amount;

  batch.set(ref,{
   id:id,
   tableId:Number(t.id),
   clientId:String(c.id),
   amount:amount,
   date:date,
   movementId:id
  });

  batch.set(db.collection("movements").doc(id),{
   id:id,
   clientId:String(c.id),
   type:"consumo",
   amount:amount,
   label:"Consumo - "+t.name,
   date:date,
   sourceItemId:id,
   tableId:Number(t.id)
  });
 });

 batch.update(
  db.collection("clients").doc(String(c._id||c.id)),
  {
   spentTotal:firebase.firestore.FieldValue.increment(total),
   balance:firebase.firestore.FieldValue.increment(total)
  }
 );

 try{
  await batch.commit();
  showMessage("Giro ripetuto: "+euro(total),"ok");
 }catch(e){
  showMessage(friendlyError(e));
 }
}


/* Un nuovo prezzo crea un nuovo giro da ricordare */

var baseAddPrice=addPrice;

addPrice=async function(n){
 var t=getTable(currentTableId);

 if(t&&t.activeClientId){
  delete lastRound[roundKey(t.id,t.activeClientId)];
 }

 return baseAddPrice(n);
};


/* ---------- TAVOLO ---------- */

var baseRenderTable=renderTable;

renderTable=function(){
 baseRenderTable();

 var select=document.getElementById("clientSelect");
 if(!select)return;

 /* Nasconde completamente il menu iPhone/Android */
 select.style.display="none";

 var oldSearch=document.getElementById("tableClientSearch");
 if(oldSearch)return;

 var search=document.createElement("input");
 search.id="tableClientSearch";
 search.type="search";
 search.autocomplete="off";
 search.placeholder="Cerca cliente per nome o cognome…";
 search.value=tableSearchText;
 search.oninput=tableClientResults;

 var results=document.createElement("div");
 results.id="tableClientResults";

 select.parentNode.insertBefore(search,select);
 select.parentNode.insertBefore(results,select);

 /* Un solo pulsante Ripeti giro per persona */
 document.querySelectorAll(".person").forEach(function(person){
  var title=person.querySelector("h3");
  if(!title)return;

  var name=title.textContent.trim();

  var c=state.clients.find(function(x){
   return x.name===name;
  });

  if(!c)return;

  var button=document.createElement("button");
  button.type="button";
  button.className="blue";
  button.style.marginTop="10px";
  button.textContent="🔁 Ripeti giro";
  button.onclick=function(){
   repeatRound(c.id);
  };

  person.appendChild(button);
 });

 if(tableSearchText){
  tableClientResults();
 }
};


/* ---------- CLIENTI DUPLICATI ---------- */

function clientExists(name){
 var n=norm(name);

 return state.clients.some(function(c){
  return norm(c.name)===n;
 });
}

var baseSaveNewClient=saveNewClient;

saveNewClient=async function(){
 var el=document.getElementById("newName");
 var name=el?(el.value||"").trim():"";

 if(!name){
  showMessage("Scrivi il nome del cliente.");
  return;
 }

 if(clientExists(name)){
  showMessage("Questo cliente esiste già.");
  return;
 }

 return baseSaveNewClient();
};

var baseSaveNewClientForTable=saveNewClientForTable;

saveNewClientForTable=async function(){
 var el=document.getElementById("newName");
 var name=el?(el.value||"").trim():"";

 if(!name){
  showMessage("Scrivi il nome del cliente.");
  return;
 }

 if(clientExists(name)){
  showMessage("Questo cliente esiste già.");
  return;
 }

 return baseSaveNewClientForTable();
};


/* ---------- RICERCA E FILTRO CLIENTI ---------- */

var baseShowClients=showClients;

showClients=function(){
 clientSearchText="";
 clientDebtFilter="all";
 baseShowClients();
};

var baseRenderClients=renderClients;

renderClients=function(){
 baseRenderClients();

 var app=document.getElementById("app");
 if(!app)return;

 var first=app.querySelector(".card");
 if(!first)return;

 var box=document.createElement("div");
 box.className="section";

 box.innerHTML=
  '<input id="clientSearch" type="search" autocomplete="off" '+
  'placeholder="Cerca cliente per nome o cognome…" value="'+
  esc(clientSearchText)+'">'+

  '<select id="clientDebtFilter" style="margin-top:8px">'+
  '<option value="all">Tutti</option>'+
  '<option value="debt">Con debito</option>'+
  '<option value="nodebt">Senza debito</option>'+
  '</select>';

 first.appendChild(box);

 var search=document.getElementById("clientSearch");
 var filter=document.getElementById("clientDebtFilter");

 filter.value=clientDebtFilter;

 function applyClientFilter(){
  clientSearchText=search.value;
  clientDebtFilter=filter.value;

  var q=norm(clientSearchText);

  Array.from(app.children).slice(1).forEach(function(card){
   var h=card.querySelector("h3");
   if(!h)return;

   var c=state.clients.find(function(x){
    return x.name===h.textContent.trim();
   });

   if(!c)return;

   var debt=clientBalance(c);

   var nameOK=!q||norm(c.name).indexOf(q)>=0;

   var debtOK=
    clientDebtFilter==="all" ||
    (clientDebtFilter==="debt" && debt>0.001) ||
    (clientDebtFilter==="nodebt" && debt<=0.001);

   card.style.display=(nameOK&&debtOK)?"":"none";
  });
 }

 search.oninput=applyClientFilter;
 filter.onchange=applyClientFilter;

 applyClientFilter();
};


/* ---------- ELIMINA CLIENTE ---------- */

async function deleteClientSafe(cid){
 var c=getClient(cid);
 if(!c)return;

 if(clientBalance(c)>0.001){
  showMessage("Prima devi azzerare il debito del cliente.");
  return;
 }

 if(clientOpenDue(c.id)>0.001){
  showMessage("Il cliente ha ancora un conto aperto.");
  return;
 }

 try{
  var items=state.items.some(function(x){
   return same(x.clientId,c.id);
  });

  if(items){
   showMessage("Il cliente ha ancora consumazioni in un tavolo.");
   return;
  }

  var history=await db.collection("movements")
   .where("clientId","==",String(c.id))
   .limit(1)
   .get();

  if(!history.empty){
   showMessage("Il cliente ha uno storico e non può essere eliminato.");
   return;
  }

  if(!confirm("Eliminare definitivamente "+c.name+"?")){
   return;
  }

  await db.collection("clients")
   .doc(String(c._id||c.id))
   .delete();

  currentClientId=null;
  showClients();
  showMessage("Cliente eliminato.","ok");

 }catch(e){
  showMessage(friendlyError(e));
 }
}

var baseRenderClientShell=renderClientShell;

renderClientShell=function(){
 baseRenderClientShell();

 var c=getClient(currentClientId);
 if(!c)return;

 var card=document.querySelector("#app .card");
 if(!card)return;

 var section=document.createElement("div");
 section.className="section";

 section.innerHTML=
  '<button type="button" class="red" '+
  'onclick="deleteClientSafe(\''+esc(c.id)+'\')">'+
  'Elimina cliente</button>';

 card.appendChild(section);
};


/* ---------- STORICO GENERALE ---------- */

var historySearchText="";
var historyTypeFilter="all";
var historyDateFilter="";

var baseShowHistory=showHistory;

showHistory=function(){
 historySearchText="";
 historyTypeFilter="all";
 historyDateFilter="";
 baseShowHistory();
};

var baseRenderHistory=renderHistory;

renderHistory=function(){
 baseRenderHistory();

 var rows=document.getElementById("historyRows");
 if(!rows)return;

 var card=rows.closest(".card");
 if(!card)return;

 var box=document.createElement("div");
 box.className="section";
 box.id="historyFilters";

 box.innerHTML=
  '<input id="historySearch" type="search" autocomplete="off" '+
  'placeholder="Cerca cliente…" value="'+esc(historySearchText)+'">'+

  '<select id="historyType" style="margin-top:8px">'+
  '<option value="all">Tutti i movimenti</option>'+
  '<option value="consumo">Consumazioni</option>'+
  '<option value="pagamento">Pagamenti</option>'+
  '</select>'+

  '<input id="historyDate" type="date" style="margin-top:8px" value="'+
  esc(historyDateFilter)+'">';

 card.insertBefore(box,rows);

 var search=document.getElementById("historySearch");
 var type=document.getElementById("historyType");
 var date=document.getElementById("historyDate");

 type.value=historyTypeFilter;

 function applyHistoryFilter(){
  historySearchText=search.value;
  historyTypeFilter=type.value;
  historyDateFilter=date.value;

  var q=norm(historySearchText);

  var elements=rows.querySelectorAll(".item");

  elements.forEach(function(el,index){
   var entry=historyDocs[index];
   if(!entry)return;

   var h=entry.data;
   var c=getClient(h.clientId);

   var nameOK=
    !q ||
    norm(c?c.name:"").indexOf(q)>=0;

   var typeOK=
    historyTypeFilter==="all" ||
    h.type===historyTypeFilter;

   var dateOK=true;

   if(historyDateFilter){
    var d=new Date(h.date);

    if(!isNaN(d.getTime())){
     var yyyy=d.getFullYear();
     var mm=String(d.getMonth()+1).padStart(2,"0");
     var dd=String(d.getDate()).padStart(2,"0");

     dateOK=(yyyy+"-"+mm+"-"+dd)===historyDateFilter;
    }else{
     dateOK=false;
    }
   }

   el.style.display=(nameOK&&typeOK&&dateOK)?"":"none";
  });
 }

 search.oninput=applyHistoryFilter;
 type.onchange=applyHistoryFilter;
 date.onchange=applyHistoryFilter;

 applyHistoryFilter();
};
