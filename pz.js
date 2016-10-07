/**
 * @fileoverview enchant.jsを使ったパズドラ風サンプル
 *
 * パズドラのダンジョン部分風のサンプル
 * 主にパズルの操作部分にフォーカス
 *
 * 方針:
 * ・設計、実装共にわかりやすさ重視、個々のメソッドにあまり機能をもたせ過ぎない。
 *
 * ポイント:
 * ・移動や消去、落下などを細かいフェーズに分けた状態管理
 * ・再帰関数によるパズルの繋がりチェック
 * ・ビット演算によるフィールド状態の管理
 *
 * 英語力ないので命名おかしかったらあしからず（汗）
 *
 * @author t.kudo
 */

// enchant.jsおまじない
enchant();

//-------------------- コア部分の初期化、ゲーム起動
window.onload = function()
{
    // ゲームオブジェクトの生成
    var game = new Core(540, 810);
    game.fps = 20;
    game.preload(['img/elements.png','img/enemy.png','img/bg.png']);

    // ゲームロード完了時の処理
    game.onload = function()
    {
        // ゲームシーンを開始
        this.pushScene(new GameScene());
    };

//-------------------- ゲーム中の定数
    const FIELD_WIDTH  = 6;                         // 横方向に並べるブロック数
    const FIELD_HEIGHT = 5;                         // 縦方向に重ねるブロック数
    const FIELD_SIZE   = FIELD_WIDTH *FIELD_HEIGHT; // フィールド全体のブロック数

    const BLOCK_SIZE   = 90;                        // ブッロク一個の縦横サイズ(px)

    // ゲームフェーズ
    const Phase =
    {
        OPENING : 0, // オープニング(初期状態)
        MOVE    : 1, // ブロックの移動
        CHECK   : 2, // ブロックの繋がりを調査
        ERASE   : 3, // ブロックの削除
        DROP    : 4, // ブロックの落下
        ATTACK  : 5, // プレイヤーの攻撃
    };

    // フィールド状態(bitフラグ)
    const FieldState = 
    {
        NORMAL             : 0, // 通常
        CHECKED_VERTIVAL   : 1, // 縦方向チェック済
        CHECKED_HORIZONTAL : 2, // 横方向チェック済
        ERASED             : 4, // 消去される予定
        EMPTY              : 8, // 削除後の空状態
    };

//-------------------- シーン
    // ゲームシーン
    var GameScene = enchant.Class.create(enchant.Scene,
    {
        // コンストラクタ
        initialize: function()
        {
            enchant.Scene.call(this);
            this.backgroundColor = '#dadfe1';

            //---------- シーンデータ
            // フェーズ管理
            this._phase = Phase.OPENING;

            // フィールドデータ
            this._field       = [];
            this._fieldStatus = [];

            // タッチして選択中のブロック
            this._touchedBlock      = null;
            this._touchedBlockIndex = -1;

            // 敵
            this._enemies = [];

            // コンボ表示
            this._combo = [];

            //---------- 基本レイヤー(重なり順の定義)
            // ブロックレイヤー
            this._blockLayer = new Group();
            this.addChild(this._blockLayer);

            // 背景レイヤー
            this._bgLayer = new Group();
            this.addChild(this._bgLayer);

            // エフェクトレイヤー
            this._effectLayer = new Group();
            this.addChild(this._effectLayer);

            //---------- タップ処理の登録
            // タッチ開始時
            this.addEventListener(Event.TOUCH_START, function(param)
            {
                // ブロック移動フェーズじゃなければリターン
                if (this._phase != Phase.MOVE) return;
                // 既にタッチ中ならリターン
                if (this._touchedBlock) return;

                // タッチされた位置からfieldのindexを計算
                var index = Math.floor(param.x/BLOCK_SIZE) +Math.floor((game.height-param.y)/BLOCK_SIZE)*FIELD_WIDTH;
                // field範囲外はリターン
                if (index<0 || index >= FIELD_SIZE) return;

                // タッチされたブロックを非表示にする
                this._field[index].visible = false;

                // タッチされたブロックをつかむ(ドラッグ中追従するスプライトの生成)
                this._touchedBlock = new Block(this._field[index].blockType);
                this._touchedBlock.x = param.x -this._touchedBlock.width/2;
                this._touchedBlock.y = param.y -this._touchedBlock.height/2;
                this._effectLayer.addChild(this._touchedBlock);

                this._touchedBlockIndex = index;
            });

            // タッチ中移動
            this.addEventListener(Event.TOUCH_MOVE, function(param)
            {
                // ブロック移動フェーズじゃなければリターン
                if (this._phase != Phase.MOVE) return;
                // タッチしてなかったらリターン
                if (!this._touchedBlock) return;

                // ドラッグ位置に追従
                this._touchedBlock.x = param.x -this._touchedBlock.width/2;
                this._touchedBlock.y = param.y -this._touchedBlock.height/2;

                // タッチされた位置からfieldのindexを計算
                var indexY = Math.floor((game.height-param.y)/BLOCK_SIZE);
                if (indexY >= FIELD_HEIGHT) indexY = FIELD_HEIGHT-1;
                var index = Math.floor(param.x/BLOCK_SIZE) +indexY*FIELD_WIDTH;
                // field範囲外はリターン
                if (index<0 || index >= FIELD_SIZE) return;

                // ブロック位置を移動してたら
                if (index != this._touchedBlockIndex)
                {
                    // 表示位置を交換
                    this._field[this._touchedBlockIndex].x = (index%FIELD_WIDTH) *BLOCK_SIZE;
                    this._field[this._touchedBlockIndex].y = game.height -(1 +Math.floor(index/FIELD_WIDTH)) *BLOCK_SIZE;

                    // 移動先にいるブロックの方はアニメーションで移動
                    this._field[index].exchange(this._touchedBlockIndex);

                    // データも交換
                    var tmp = this._field[index];
                    this._field[index] = this._field[this._touchedBlockIndex];
                    this._field[this._touchedBlockIndex] = tmp;

                    this._touchedBlockIndex = index;
                }
            });

            // タッチ終了時
            this.addEventListener(Event.TOUCH_END, function(param)
            {
                // ブロック移動フェーズじゃなければリターン
                if (this._phase != Phase.MOVE) return;
                // タッチしてなかったらリターン
                if (!this._touchedBlock) return;

                // 消してたブロックを表示
                this._field[this._touchedBlockIndex].visible = true;

                // つかんでたブロックの方は削除
                this._effectLayer.removeChild(this._touchedBlock);
                this._touchedBlock = null;
                this._touchedBlockIndex = -1;

                // 繋がりチェックフェーズへ
                this.changePhase(Phase.CHECK);
            });

            //---------- ゲーム開始
            this.startGame();
        },

        // ゲームの開始
        startGame : function()
        {
            // 背景表示
            var bg = new Bg();
            this._bgLayer.addChild(bg);

            // 敵の配置
            var enemy = new Enemy();
            enemy.x = 0;
            enemy.y = 0;
            this._bgLayer.addChild(enemy);
            this._enemies.push(enemy);

            // フィールドの初期化
            // (初期判定入れてないので、最初から繋がってるブロック有り)
            for (var i=0; i<FIELD_SIZE; i++)
            {
                // ブッロクの配置
                var block = new Block(Math.floor(Math.random()*BlockType.SIZE));
                block.x = (i%FIELD_WIDTH) *BLOCK_SIZE;
                block.y = game.height -(1 +Math.floor(i/FIELD_WIDTH)) *BLOCK_SIZE;
                this._blockLayer.addChild(block);
                this._field.push(block);

                // 状態を設定
                this._fieldStatus.push(FieldState.NORMAL);
            }

            // ブロック操作フェーズへ
            this.changePhase(Phase.MOVE);
        },

        // フェーズ管理
        changePhase : function(phase)
        {
            this._phase = phase;
            switch (phase)
            {
                // オープニング
                case Phase.OPENING:
                    // 特にすることなし
                break;

                // 移動フェーズ
                case Phase.MOVE:
                    // 特にすることなし
                break;

                // 繋がりチェックフェーズ
                case Phase.CHECK:
                    // ブロックの繋がりを調査
                    this.checkAllBlockChains();
                break;

                // 削除フェーズ
                case Phase.ERASE:
                    this.eraseAllMarkedBlocks();
                break;

                // 落下フェーズ
                case Phase.DROP:
                    this.dropBlocks();
                break;

                // 攻撃フェーズ
                case Phase.ATTACK:
                    this.attack();
                break;
            }
        },

        // ブロックの繋がりをチェック開始
        checkAllBlockChains : function()
        {
            // フィールドステータスの初期化
            for (var i=0; i<FIELD_SIZE; i++) this._fieldStatus[i] = FieldState.NORMAL;

            // ブロックを順番にチェック
            var eraseFlag = false;
            for (var i=0; i<FIELD_SIZE; i++)
            {
                // 縦方向の繋がりをチェックして
                var vChain = this.checkVerticalBlockChain(i,this._field[i].blockType);
                // 繋がりが3以上なら
                if (vChain.length >= 3)
                {
                    // 削除フラグをたてる
                    for (var i=0; i<vChain.length; i++) this._fieldStatus[vChain[i]] |= FieldState.ERASED;
                    eraseFlag = true;
                }

                // 横方向の繋がりをチェックして
                var hChain = this.checkHorizontalBlockChain(i,this._field[i].blockType);
                // 繋がりが3以上なら
                if (hChain.length >= 3)
                {
                    // 削除フラグをたてる
                    for (var i=0; i<hChain.length; i++) this._fieldStatus[hChain[i]] |= FieldState.ERASED;
                    eraseFlag = true;
                }
            }

            // 削除フラグが立ってたら(消すブロックがあったら)
            if (eraseFlag)
            {
                // 削除フェーズへ
                this.changePhase(Phase.ERASE);
            }
            // 消すブロックが無くてコンボがあれば攻撃フェーズへ
            else if (this._combo.length)
            {
                this.changePhase(Phase.ATTACK);
            }
            // コンボも無かったら移動フェーズへ
            else
            {
                this.changePhase(Phase.MOVE);
            }
        },

        // 縦方向にブロックの繋がりを見ていく
        checkVerticalBlockChain : function(index,blockType)
        {
            // 違うタイプはリターン
            if (this._field[index].blockType != blockType) return [];
            // チェック済もリターン
            if (this._fieldStatus[index]&FieldState.CHECKED_VERTIVAL) return [];

            // ブロックをチェック済にする
            this._fieldStatus[index] |= FieldState.CHECKED_VERTIVAL;

            //----- 再帰的にブロックをチェックしていく
            var upChain   = (index+FIELD_WIDTH<FIELD_SIZE)? this.checkVerticalBlockChain(index +FIELD_WIDTH, blockType):[];
            var downChain = (index-FIELD_WIDTH>=0)?         this.checkVerticalBlockChain(index -FIELD_WIDTH, blockType):[];

            // チェックしたインデックスをリターン
            return downChain.concat([index],upChain);
        },

        // 横方向にブロックの繋がりを見ていく
        checkHorizontalBlockChain : function(index,blockType)
        {
            // 違うタイプはリターン
            if (this._field[index].blockType != blockType) return [];
            // チェック済もリターン
            if (this._fieldStatus[index]&FieldState.CHECKED_HORIZONTAL) return [];

            // ブロックをチェック済にする
            this._fieldStatus[index] |= FieldState.CHECKED_HORIZONTAL;

            //----- 再帰的にブロックをチェックしていく
            var leftChain  = (index%FIELD_WIDTH)?     this.checkHorizontalBlockChain(index -1, blockType):[];
            var rightChain = ((index+1)%FIELD_WIDTH)? this.checkHorizontalBlockChain(index +1, blockType):[];

            // チェックしたインデックスをリターン
            return leftChain.concat([index],rightChain);
        },

        // 削除フラグのついたブロックを削除する
        eraseAllMarkedBlocks : function()
        {
            var eraseFlag = false;
            for (var i=0; i<FIELD_SIZE; i++)
            {
                // 空の場所は飛ばす
                if (this._fieldStatus[i] & FieldState.EMPTY) continue;

                // 削除フラグ付きのブロックの繋がりをチェックする
                var chain = this.checkErasedBlockChain(i,this._field[i].blockType);
                // 繋がりを見つけたら
                if (chain.length > 0)
                {
                    // ブロックを消す
                    var avgXIndex = 0;
                    var avgYIndex = 0;
                    for (var i=0; i<chain.length; i++)
                    {
                        var index = chain[i];
                        this._field[index].erase();
                        this._field[index]        = null;
                        this._fieldStatus[index] |= FieldState.EMPTY;

                        avgXIndex += index%FIELD_WIDTH;
                        avgYIndex += Math.floor(index/FIELD_WIDTH);
                    }
                    // 繋がりの中心を計算
                    avgXIndex /= chain.length;
                    avgYIndex /= chain.length;

                    // コンボ表示
                    var combo = new ComboLabel(this._combo.length+1 +'combo');
                    combo.x = avgXIndex*BLOCK_SIZE +BLOCK_SIZE/2 -combo.width/2;
                    combo.y = game.height -avgYIndex*BLOCK_SIZE -BLOCK_SIZE/2 -combo.height/2;
                    this._effectLayer.addChild(combo);
                    this._combo.push(combo);

                    combo.appear();

                    // 消すアニメーションを待ってから、また消すのが有るかチェックする
                    this.tl.delay(game.fps/2).then(function(){this.eraseAllMarkedBlocks();});

                    return;
                }
            }

            // 落下フェーズへ
            this.changePhase(Phase.DROP);
        },

        // 削除フラグ付きのブロックの繋がりをチェックする
        checkErasedBlockChain : function(index,blockType)
        {
            // フラグがついてなければリターン
            if (!(this._fieldStatus[index]&FieldState.ERASED)) return [];
            // 違うタイプはリターン
            if (this._field[index].blockType != blockType) return [];

            // 削除フラグをオフにする(重複チェックによる無限ループの回避)
            this._fieldStatus[index] ^= FieldState.ERASED;

            //----- 再帰的にブロックをチェックしていく
            var upChain    = (index+FIELD_WIDTH<FIELD_SIZE)? this.checkErasedBlockChain(index +FIELD_WIDTH, blockType):[];
            var downChain  = (index-FIELD_WIDTH>=0)?         this.checkErasedBlockChain(index -FIELD_WIDTH, blockType):[];
            var leftChain  = (index%FIELD_WIDTH)?            this.checkErasedBlockChain(index -1, blockType):[];
            var rightChain = ((index+1)%FIELD_WIDTH)?        this.checkErasedBlockChain(index +1, blockType):[];

            // チェックしたインデックスをリターン
            return [index].concat(upChain,downChain,leftChain,rightChain);
        },

        // ブロックを落下させる
        dropBlocks : function()
        {
            for (var i=0; i<FIELD_WIDTH; i++)
            {
                var emptyCount = 0;
                for (var j=0; j<FIELD_HEIGHT; j++)
                {
                    var index = i +j*FIELD_WIDTH;
                    // 空きを見つけたら
                    if (this._fieldStatus[index] & FieldState.EMPTY)
                    {
                        // 空き数をカウント
                        emptyCount++;
                    }
                    // ブロックを見つけて、空きカウントがあったら(下に空きがあったら)
                    else if (emptyCount)
                    {
                        // 空きの分ブロックを詰める
                        this._field[index].drop(emptyCount);
                        this._field[index -emptyCount*FIELD_WIDTH] = this._field[index];
                        this._field[index] = null;

                        this._fieldStatus[index] |= FieldState.EMPTY;
                        this._fieldStatus[index -emptyCount*FIELD_WIDTH] ^= FieldState.EMPTY;
                    }
                }

                // 空きがあったら
                if (emptyCount)
                {
                    // 空き分新たなブロックを追加する
                    for (var k=0; k<emptyCount; k++)
                    {
                        var block = new Block(Math.floor(Math.random()*BlockType.SIZE));
                        block.x = i*BLOCK_SIZE;
                        block.y = game.height -(FIELD_HEIGHT +k+1)*BLOCK_SIZE;
                        this._blockLayer.addChild(block);
                        this._field[i +(FIELD_HEIGHT -(emptyCount-k))*FIELD_WIDTH] = block;

                        block.drop(emptyCount);
                    }
                }
            }

            // 落下時間分待ってまた繋がりチェックへ
            this.tl.delay(game.fps/3).then(function(){this.changePhase(Phase.CHECK)});
        },

        // 攻撃
        attack : function()
        {
            // コンボラベルを順に削除
            for (var i=0; i<this._combo.length; i++)
            {
                this._combo[i].tl.delay(i*game.fps/3).then(function(){this.disappear();});
            }

            // ダメージラベル
            var damage = new DamageLabel();
            damage.x=game.width/2 -damage.width/2;
            damage.y=290;
            this._effectLayer.addChild(damage);

            damage.chargeDamege(this._combo.length);

            // コンボを空にして
            this._combo = [];

            // 移動フェーズへ
            this.changePhase(Phase.MOVE);
        }
    });

//---------- スプライト
    // 背景
    var Bg = enchant.Class.create(enchant.Sprite,
    {
        // コンストラクタ
        initialize: function()
        {
            enchant.Sprite.call(this,540,360);
            this.image     = game.assets["img/bg.png"];
        },
    });

    // パズルのブロックタイプ
    const BlockType = 
    {
        FIRE    : 0,
        WATER   : 1,
        LEAF    : 2,
        THUNDER : 3,

        SIZE    : 4,
    };
    // ブロッククラス
    var Block = enchant.Class.create(enchant.Sprite,
    {
        // コンストラクタ
        initialize : function(type)
        {
            enchant.Sprite.call(this,90,90);
            this.image     = game.assets["img/elements.png"];
            this.blockType = type;
        },

        // 位置交換
        exchange : function(index)
        {
            var x = (index%FIELD_WIDTH) *BLOCK_SIZE;
            var y = game.height -(1 +Math.floor(index/FIELD_WIDTH)) *BLOCK_SIZE;

            this.tl.moveTo(x,y,game.fps/8);
        },

        // 落下
        drop : function(dropFieldHeight)
        {
            this.tl.moveBy(0,dropFieldHeight*BLOCK_SIZE,game.fps/3);
        },

        // ブロックの消去
        erase : function()
        {
            this.tl.fadeOut(game.fps/2).removeFromScene();
        },

        // ブロックタイプ
        blockType : {
            get : function() {return this.frame;},
            set : function(type) {this.frame = type;}
        },
    });

    // 敵クラス
    var Enemy = enchant.Class.create(enchant.Sprite,
    {
        // コンストラクタ
        initialize : function()
        {
            enchant.Sprite.call(this,540,360);
            this.image = game.assets["img/enemy.png"];
        }
    });

    // コンボカラーリスト
    const COMBO_COLORS = ['rgb(255,0,0)','rgb(255,255,0)','rgb(0,255,0)','rgb(0,255,255)','rgb(0,0,255)','rgb(255,0,255)'];

    // コンボラベル
    var ComboLabel = enchant.Class.create(enchant.Label,
    {
        // コンストラクタ
        initialize : function(text)
        {
            enchant.Label.call(this,text);

            // TODO 要調査、ラベルの変形原点を中心にする方法
            this.textAlign = 'center';
            this.height    = 50;
            this.font      = '40px monospace';
            this.visible   = false;
            this.scale(2);

            // キラキラ処理
            this.addEventListener(Event.ENTER_FRAME, function()
            {
                this.color = COMBO_COLORS[this.age%COMBO_COLORS.length];
            });
        },

        // 出現
        appear : function()
        {
            this.visible = true;
            this.opacity = 0;
            this.tl.fadeIn(game.fps/4).scaleTo(1.5,game.fps/4).and().moveBy(0,-40,game.fps/4).scaleTo(1,game.fps/4).and().moveBy(0,40,game.fps/4);
        },

        // 削除
        disappear : function()
        {
            this.tl.fadeOut(game.fps/3).and().scaleTo(2,game.fps/3).removeFromScene();
        }
    });

    // ダメージラベル
    var DamageLabel = enchant.Class.create(enchant.Label,
    {
        // コンストラクタ
        initialize : function()
        {
            enchant.Label.call(this,'0');

            this.color = '#f22613';

            // TODO 要調査、ラベルの変形原点を中心にする方法
            this.textAlign = 'center';
            this.height    = 70;
            this.font      = '60px monospace';
        },

        // ぐわんぐわんなるやつ
        chargeDamege : function(comboCount)
        {
            // ダメージ値のカウント
            this.addEventListener(Event.ENTER_FRAME,this.damageUpdate);

            // ぐわんぐわん
            for (var i=0; i<comboCount; i++)
            {
                this.tl.scaleTo(1.5,game.fps/6).and().moveBy(0,-30,game.fps/6).scaleTo(1,game.fps/6).and().moveBy(0,30,game.fps/6);
            }

            // とりあえずそのまま消しちゃう
            this.tl.then(function(){this.removeEventListener(Event.ENTER_FRAME,this.damageUpdate);}).delay(game.fps).fadeOut(game.fps/2).removeFromScene();
        },

        // ダメージ値の更新
        damageUpdate : function()
        {
            this.text = String(Number(this.text)+19);
        }
    });

    // ゲーム開始
    game.start();
};
