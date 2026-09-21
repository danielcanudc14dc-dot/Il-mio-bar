var clientSearchText="",clientDebtFilter="all",tableClientSearchText="";
var oldOpenTable=openTable;
openTable=function(id){tableClientSearchText="";oldOpenTable(id)};

function srch(v){
 return String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim()
}

function filterTableClientSelect(){
 var i=document.getElementById("tableClientSearch"),
 s=document.getElementById("clientSelect"),t=getTable(currentTableId);
 if(!i||!s||!t)return;
 tableClientSearchText=i.value;
 var q=srch(i.value),active=t.activeClientId||"",v=s.value||active;
 var a=state.clients.filter(function(c){
  return !q||srch(c.name).indexOf(q)>=0||same(c.id,active)
 });
 s.innerHTML='<option value="">Seleziona cliente…</option>'+
 a.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>'}).join("");
 if(v)s.value=v
}

var originalRenderTable=renderTable;
renderTable=function(){
 originalRenderTable();
 var sel=document.getElementById("clientSelect");
 if(!sel)return;

 var inp=document.createElement("input");
 inp.id="tableClientSearch";
 inp.placeholder="Cerca cliente…";
 inp.value=tableClientSearchText;
 inp.oninput=filterTableClientSelect;
 sel.parentNode.insertBefore(inp,sel);

 document.querySelectorAll(".person").forEach(function(p){
  var h=p.querySelector("h3");
  if(!h)return;
  var name=h.textContent,cl=state.clients.find(function(c){return c.name===name});
  if(!cl)return;

  var b=document.createElement("button");
  b.className="blue";
  b.textContent="🔁 Ripeti giro";
  b.onclick=function(){repeatLastRound(cl.id)};
  p.appendChild(b)
 })
};

async function repeatLastRound(cid){
 var t=getTable(currentTableId),c=getClient(cid);
 if(!t||!c)return;

 var all=tableItems(t.id).slice().sort(function(a,b){
  return String(a.date||"").localeCompare(String(b.date||""))
 });

 var k=-1;
 for(var i=all.length-1;i>=0;i--){
  if(same(all[i].clientId,cid)){k=i;break}
 }
 if(k<0){showMessage("Nessun giro da ripetere.");return}

 var a=[];
 for(var j=k;j>=0;j--){
  if(!same(all[j].clientId,cid))break;
  a.unshift(all[j])
 }

 var batch=db.batch(),tot=0,base=Date.now();

 a.forEach(function(x,n){
  var v=Number(x.amount||0);
  if(v<=0)return;
  var r=db.collection("openItems").doc(),id=r.id,
  d=new Date(base+n).toISOString();
  tot+=v;

  batch.set(r,{
   id:id,tableId:Number(t.id),clientId:String(c.id),
   amount:v,date:d,movementId:id
  });

  batch.set(db.collection("movements").doc(id),{
   id:id,clientId:String(c.id),type:"consumo",amount:v,
   label:"Consumo - "+t.name,date:d,sourceItemId:id,
   tableId:Number(t.id)
  })
 });

 batch.update(db.collection("clients").doc(String(c._id||c.id)),{
  spentTotal:firebase.firestore.FieldValue.increment(tot),
  balance:firebase.firestore.FieldValue.increment(tot)
 });

 try{
  await batch.commit();
  showMessage("Giro ripetuto: "+euro(tot),"ok")
 }catch(e){showMessage(friendlyError(e))}
}

var originalShowClients=showClients;
showClients=function(){
 clientSearchText="";clientDebtFilter="all";
 originalShowClients()
};

var originalRenderClients=renderClients;
renderClients=function(){
 originalRenderClients();
 var app=document.getElementById("app"),
 first=app.querySelector(".card");
 if(!first)return;

 var i=document.createElement("input");
 i.placeholder="Cerca cliente…";
 i.style.marginTop="12px";

 var s=document.createElement("select");
 s.style.marginTop="8px";
 s.innerHTML='<option value="all">Tutti</option>'+
 '<option value="debt">Con debito</option>'+
 '<option value="nodebt">Senza debito</option>';

 first.appendChild(i);first.appendChild(s);

 function f(){
  var q=srch(i.value);
  Array.from(app.children).slice(1).forEach(function(x){
   var h=x.querySelector("h3");
   if(!h)return;
   var c=state.clients.find(function(z){return z.name===h.textContent});
   if(!c)return;
   var d=clientBalance(c);
   var ok=(!q||srch(c.name).indexOf(q)>=0)&&
   (s.value==="all"||(s.value==="debt"?d>.001:d<=.001));
   x.style.display=ok?"":"none"
  })
 }
 i.oninput=f;s.onchange=f
};

var originalShowHistory=showHistory;
showHistory=function(){
 originalShowHistory();
 setTimeout(addHistoryFilters,0)
};

function addHistoryFilters(){
 var app=document.getElementById("app"),card=app.querySelector(".card");
 if(!card||document.getElementById("histSearch"))return;

 var box=document.createElement("div");
 box.className="section";
 box.innerHTML=
 '<input id="histSearch" placeholder="Cerca cliente…">'+
 '<div class="row section">'+
 '<select id="histType">'+
 '<option value="all">Tutti</option>'+
 '<option value="consumo">Consumazioni</option>'+
 '<option value="pagamento">Pagamenti</option>'+
 '</select>'+
 '<input id="histDate" type="date">'+
 '</div>';

 card.insertBefore(box,document.getElementById("historyRows"));

 function f(){
  var q=srch(document.getElementById("histSearch").value),
  typ=document.getElementById("histType").value,
  dt=document.getElementById("histDate").value;

  document.querySelectorAll("#historyRows .item").forEach(function(el,n){
   var x=historyDocs[n];
   if(!x)return;
   var h=x.data,c=getClient(h.clientId),
   day=(h.date||"").slice(0,10);

   el.style.display=
   (!q||srch(c?c.name:"").indexOf(q)>=0)&&
   (typ==="all"||h.type===typ)&&
   (!dt||day===dt)?"":"none"
  })
 }

 document.getElementById("histSearch").oninput=f;
 document.getElementById("histType").onchange=f;
 document.getElementById("histDate").onchange=f
}


// CORREZIONE CLIENTI + RIPETI GIRO + STORICO
var _renderClients2=renderClients;
renderClients=function(){
 _renderClients2();

 var app=document.getElementById("app");
 var first=app.querySelector(".card");
 if(!first)return;

 if(!document.getElementById("clientSearchFix")){
  var box=document.createElement("div");
  box.className="section";
  box.innerHTML=
   '<input id="clientSearchFix" placeholder="Cerca cliente per nome o cognome">'+
   '<select id="clientDebtFix" style="margin-top:8px">'+
   '<option value="all">Tutti</option>'+
   '<option value="debt">Con debito</option>'+
   '<option value="nodebt">Senza debito</option>'+
   '</select>';
  first.appendChild(box);

  function filtraClienti(){
   var q=srch(document.getElementById("clientSearchFix").value);
   var tipo=document.getElementById("clientDebtFix").value;

   Array.from(app.children).slice(1).forEach(function(card){
    var h=card.querySelector("h3");
    if(!h)return;
    var c=state.clients.find(function(x){
     return x.name===h.textContent;
    });
    if(!c)return;

    var debito=clientBalance(c);
    var okNome=!q||srch(c.name).indexOf(q)>=0;
    var okDebito=tipo==="all"||
     (tipo==="debt"&&debito>0.001)||
     (tipo==="nodebt"&&debito<=0.001);

    card.style.display=okNome&&okDebito?"":"none";
   });
  }

  document.getElementById("clientSearchFix").oninput=filtraClienti;
  document.getElementById("clientDebtFix").onchange=filtraClienti;
 }
};

var _renderTable2=renderTable;
renderTable=function(){
 _renderTable2();

 document.querySelectorAll(".person").forEach(function(p){
  if(p.querySelector(".repeatRoundFix"))return;

  var h=p.querySelector("h3");
  if(!h)return;

  var nome=h.textContent.trim();
  var c=state.clients.find(function(x){
   return x.name===nome;
  });
  if(!c)return;

  var b=document.createElement("button");
  b.className="blue repeatRoundFix";
  b.style.marginTop="10px";
  b.textContent="🔁 Ripeti giro";
  b.onclick=function(){repeatLastRound(c.id);};
  p.appendChild(b);
 });
};

var _renderHistory2=renderHistory;
renderHistory=function(){
 _renderHistory2();
 setTimeout(addHistoryFilters,0);
};
